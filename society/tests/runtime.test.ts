import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProcessSandbox } from '../src/sandbox/process.js';
import { ClaudeCodeRuntime } from '../src/runtime/claude-code.js';

/** A fake `claude` binary that emits stream-json like the real CLI, so the runtime's metering and kill logic can be tested offline. */
function fakeClaude(dir: string, script: string) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'claude'), `#!/usr/bin/env bash\n${script}\n`, { mode: 0o755 });
  return bin;
}
const msg = (id: string, model: string, usage: any, content: any[]) => JSON.stringify({ type: 'assistant', message: { id, model, usage, content } });

describe('ClaudeCodeRuntime', () => {
  it('meters per-message usage once, reconciles with the reported total, captures tool calls and final text', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'));
    const bin = fakeClaude(dir, `
echo '${msg('m1', 'claude-haiku-4-5', { input_tokens: 1000000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }])}'
echo '${msg('m1', 'claude-haiku-4-5', { input_tokens: 1000000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, [{ type: 'text', text: 'dup block same message' }])}'
echo '${msg('m2', 'claude-haiku-4-5', { input_tokens: 0, output_tokens: 100000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, [{ type: 'text', text: 'All done.' }])}'
echo '{"type":"result","subtype":"success","total_cost_usd":2.0,"usage":{"input_tokens":1000000,"output_tokens":100000},"result":"All done."}'
`);
    const sb = new ProcessSandbox('t', dir, { PATH: `${bin}:${process.env.PATH}` });
    const rt = new ClaudeCodeRuntime(sb, { transcriptDir: path.join(dir, 'tr'), env: {}, authMode: 'inherit', mcpConfig: () => '{}' });
    const charges: number[] = []; const tools: string[] = [];
    const h = await rt.start({ runId: 'r1', agentId: 'A', prompt: 'go', systemPrompt: 'sys', model: 'claude-haiku-4-5', effort: 'low', tools: ['Bash'], sessionId: '00000000-0000-4000-8000-000000000000', isFirstRun: true, maxBudgetUsd: 5, maxRunSec: 30 }, { onUsage: (d) => { charges.push(d); }, onToolCall: (n) => tools.push(n) });
    const r = await h.result;
    expect(r.exitReason).toBe('completed');
    expect(r.finalText).toBe('All done.');
    expect(tools).toEqual(['Bash']);
    expect(r.turns).toBe(2);
    // streamed: $1.00 (1M in) + $0.50 (100k out) = 1.5; reported total 2.0 → one top-up of 0.5
    expect(charges.map((c) => +c.toFixed(4))).toEqual([1, 0.5, 0.5]);
    expect(r.costUsd).toBeCloseTo(2.0);
    expect(fs.existsSync(r.transcriptPath!)).toBe(true);
  });

  it('kills the run when the budget callback says stop', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'));
    const bin = fakeClaude(dir, `
for i in 1 2 3 4 5 6 7 8 9 10; do
  echo '${msg('mX', 'claude-haiku-4-5', { input_tokens: 1000000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, [{ type: 'text', text: 'spending' }])}' | sed "s/mX/m$i/"
  sleep 0.2
done
echo '{"type":"result","subtype":"success","total_cost_usd":10}'
`);
    const sb = new ProcessSandbox('t', dir, { PATH: `${bin}:${process.env.PATH}` });
    const rt = new ClaudeCodeRuntime(sb, { transcriptDir: path.join(dir, 'tr'), env: {}, authMode: 'inherit', mcpConfig: () => '{}' });
    let spent = 0;
    const h = await rt.start({ runId: 'r2', agentId: 'A', prompt: 'go', systemPrompt: 'sys', model: 'claude-haiku-4-5', effort: 'low', tools: [], sessionId: '00000000-0000-4000-8000-000000000001', isFirstRun: false, maxBudgetUsd: 2, maxRunSec: 30 }, { onUsage: (d) => { spent += d; return spent < 2.5; } });
    const r = await h.result;
    expect(r.exitReason).toBe('budget');
    expect(spent).toBeLessThan(5);
  });

  it('reports errors and non-zero exits', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'));
    const bin = fakeClaude(dir, `echo 'boom' >&2; exit 3`);
    const sb = new ProcessSandbox('t', dir, { PATH: `${bin}:${process.env.PATH}` });
    const rt = new ClaudeCodeRuntime(sb, { transcriptDir: path.join(dir, 'tr'), env: {}, authMode: 'inherit', mcpConfig: () => '{}' });
    const r = await (await rt.start({ runId: 'r3', agentId: 'A', prompt: 'go', systemPrompt: 'sys', model: 'm', effort: 'low', tools: [], sessionId: '00000000-0000-4000-8000-000000000002', isFirstRun: true, maxBudgetUsd: 1, maxRunSec: 30 }, {})).result;
    expect(r.exitReason).toBe('error');
    expect(r.error).toMatch(/code 3/);
  });
});
