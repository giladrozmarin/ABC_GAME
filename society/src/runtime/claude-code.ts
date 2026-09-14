import fs from 'node:fs';
import path from 'node:path';
import type { Sandbox } from '../sandbox/provider.js';
import { costOf, type Usage } from '../economy/pricing.js';
import type { AgentRuntime, RunCallbacks, RunHandle, RunResult, RunSpec } from './types.js';
import { truncate } from '../util.js';

export interface ClaudeCodeRuntimeOptions {
  /** Where to persist run transcripts (stream-json) on the orchestrator side. */
  transcriptDir: string;
  /** Extra env for every run (e.g. gateway credentials). */
  env: Record<string, string>;
  /** MCP server config JSON injected via --mcp-config. */
  mcpConfig: (agentId: string) => string;
  /** 'bare' when using the gateway (auth strictly via ANTHROPIC_API_KEY); 'inherit' to reuse host credentials. */
  authMode: 'gateway' | 'inherit';
}

/**
 * Runs Claude Code headless (`claude -p --output-format stream-json`) INSIDE the
 * agent's sandbox. This gives every agent a full software-engineering runtime
 * (shell, files, git, web) confined by the sandbox, while the society
 * capabilities arrive over MCP from the orchestrator.
 */
export class ClaudeCodeRuntime implements AgentRuntime {
  readonly name = 'claude-code';
  constructor(private sandbox: Sandbox, private opts: ClaudeCodeRuntimeOptions) {}

  async start(spec: RunSpec, cb: RunCallbacks): Promise<RunHandle> {
    const argv = ['claude', '-p', spec.prompt, '--output-format', 'stream-json', '--verbose', '--model', spec.model,
      '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
      '--tools', spec.tools.length ? spec.tools.join(',') : '', '--allowedTools', ...spec.tools, 'mcp__society__*',
      '--mcp-config', this.opts.mcpConfig(spec.agentId), '--strict-mcp-config',
      '--max-budget-usd', spec.maxBudgetUsd.toFixed(4), '--disable-slash-commands', '--no-chrome'];
    if (spec.effort) argv.push('--effort', spec.effort);
    if (spec.isFirstRun) { argv.push('--session-id', spec.sessionId); if (spec.systemPrompt) argv.push('--system-prompt', spec.systemPrompt); }
    else argv.push('--resume', spec.sessionId);
    if (spec.jsonSchema) argv.push('--json-schema', JSON.stringify(spec.jsonSchema));
    if (this.opts.authMode === 'gateway') argv.push('--bare');
    else argv.push('--setting-sources', '');

    fs.mkdirSync(this.opts.transcriptDir, { recursive: true });
    const transcriptPath = path.join(this.opts.transcriptDir, `${spec.runId}.jsonl`);
    const transcript = fs.createWriteStream(transcriptPath);

    const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let costUsd = 0;
    let reportedCost: number | null = null;
    let finalText = '';
    let structuredOutput: unknown;
    let turns = 0;
    let toolCalls = 0;
    let exitReason: RunResult['exitReason'] = 'completed';
    let errorMsg: string | undefined;
    let stderrTail = '';
    let buf = '';
    const seenMsgIds = new Set<string>();

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      transcript.write(line + '\n');
      let ev: any;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'assistant' && ev.message) {
        const m = ev.message;
        for (const block of m.content ?? []) {
          if (block.type === 'text' && block.text) { finalText = block.text; cb.onActivity?.('text', truncate(block.text, 300)); }
          else if (block.type === 'tool_use') {
            toolCalls++;
            cb.onToolCall?.(block.name, block.input);
            cb.onActivity?.('tool', describeTool(block.name, block.input));
          }
        }
        // Each assistant message is one API call; usage is repeated across its streamed blocks — count once per message id.
        if (m.usage && m.id && !seenMsgIds.has(m.id)) {
          seenMsgIds.add(m.id);
          turns++;
          const u: Usage = {
            inputTokens: m.usage.input_tokens ?? 0, outputTokens: m.usage.output_tokens ?? 0,
            cacheReadTokens: m.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: m.usage.cache_creation_input_tokens ?? 0,
          };
          add(usage, u);
          const delta = costOf(m.model ?? spec.model, u);
          costUsd += delta;
          const ok = cb.onUsage?.(delta, u, m.model ?? spec.model);
          if (ok === false) { exitReason = 'budget'; void handle.kill('budget'); }
        }
      } else if (ev.type === 'result' || typeof ev.total_cost_usd === 'number') {
        if (typeof ev.total_cost_usd === 'number') reportedCost = ev.total_cost_usd;
        if (ev.usage) {
          // Authoritative totals for this invocation.
          usage.inputTokens = ev.usage.input_tokens ?? usage.inputTokens;
          usage.outputTokens = ev.usage.output_tokens ?? usage.outputTokens;
          usage.cacheReadTokens = ev.usage.cache_read_input_tokens ?? usage.cacheReadTokens;
          usage.cacheWriteTokens = ev.usage.cache_creation_input_tokens ?? usage.cacheWriteTokens;
        }
        if (ev.structured_output !== undefined) structuredOutput = ev.structured_output;
        if (typeof ev.result === 'string' && ev.result) finalText = ev.result;
        if (ev.is_error || (ev.subtype && ev.subtype !== 'success')) {
          if (exitReason === 'completed') exitReason = /budget/i.test(String(ev.subtype ?? ev.result ?? '')) ? 'budget' : 'error';
          errorMsg = String(ev.result ?? ev.subtype ?? 'runtime error');
        }
      } else if (ev.type === 'system' && ev.subtype === 'task_summary' && ev.detail) {
        cb.onActivity?.('text', truncate(String(ev.detail), 200));
      }
    };

    const exec = await this.sandbox.exec(argv, {
      env: { ...this.opts.env, MCP_TOOL_TIMEOUT: '180000', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
      timeoutMs: spec.maxRunSec * 1000,
      onStdout: (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { handleLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
      },
      onStderr: (chunk) => { stderrTail = (stderrTail + chunk).slice(-4000); },
    });

    const started = Date.now();
    const result = (async (): Promise<RunResult> => {
      const { exitCode } = await exec.wait();
      if (buf.trim()) handleLine(buf);
      transcript.end();
      if (exitReason === 'completed' && Date.now() - started >= spec.maxRunSec * 1000 - 500 && exitCode !== 0) exitReason = 'timeout';
      if (exitReason === 'completed' && exitCode !== 0) { exitReason = 'error'; errorMsg = errorMsg ?? `claude exited with code ${exitCode}: ${stderrTail.slice(-800)}`; }
      const finalCost = reportedCost !== null ? Math.max(reportedCost, costUsd) : costUsd;
      // Only charge the difference between the authoritative total and what was already streamed.
      if (finalCost > costUsd + 1e-9) cb.onUsage?.(finalCost - costUsd, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, spec.model);
      return { runId: spec.runId, costUsd: finalCost, usage, exitReason, finalText, structuredOutput, turns, toolCalls, error: errorMsg, transcriptPath };
    })();

    const handle: RunHandle = {
      result,
      kill: async (reason) => { exitReason = reason; await exec.kill(); },
    };
    return handle;
  }
}

function add(a: Usage, b: Usage) {
  a.inputTokens += b.inputTokens; a.outputTokens += b.outputTokens; a.cacheReadTokens += b.cacheReadTokens; a.cacheWriteTokens += b.cacheWriteTokens;
}

export function describeTool(name: string, input: any): string {
  const n = name.replace(/^mcp__society__/, 'society.');
  if (!input || typeof input !== 'object') return n;
  if (name === 'Bash') return `$ ${truncate(String(input.command ?? ''), 160)}`;
  if (['Read', 'Write', 'Edit', 'MultiEdit'].includes(name)) return `${name} ${truncate(String(input.file_path ?? ''), 120)}`;
  if (name === 'Glob' || name === 'Grep') return `${name} ${truncate(String(input.pattern ?? ''), 100)}`;
  if (name === 'WebFetch') return `WebFetch ${truncate(String(input.url ?? ''), 120)}`;
  if (name === 'WebSearch') return `WebSearch ${truncate(String(input.query ?? ''), 120)}`;
  const first = Object.entries(input).slice(0, 3).map(([k, v]) => `${k}=${truncate(typeof v === 'string' ? v : JSON.stringify(v), 60)}`).join(' ');
  return `${n}(${first})`;
}
