import type { Orchestrator } from '../society/orchestrator.js';
import { buildCapabilities, callCapability, type Capability } from '../society/capabilities.js';
import type { AgentRuntime, RunCallbacks, RunHandle, RunResult, RunSpec } from './types.js';
import { sleep } from '../util.js';

/**
 * MOCK MODE ONLY. No model is called. A pseudo-random policy exercises the
 * same capability API as real agents so the orchestrator, economy and UI can
 * be demonstrated offline. Decisions here are random, not intelligent, and the
 * UI labels the experiment as mock.
 */
export class MockRuntime implements AgentRuntime {
  readonly name = 'mock';
  private caps: Capability[];
  private rng: () => number;
  constructor(private orch: Orchestrator, private agentId: string) {
    this.caps = buildCapabilities(orch);
    let seed = [...agentId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    this.rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  }

  async start(spec: RunSpec, cb: RunCallbacks): Promise<RunHandle> {
    let killed = false;
    const result = (async (): Promise<RunResult> => {
      const s = this.orch.society;
      const me = s.agents.get(this.agentId)!;
      const sb = this.orch.sandboxes.get(this.agentId)!;
      let cost = 0; let turns = 0; let toolCalls = 0;
      const call = async (name: string, args: unknown) => {
        toolCalls++;
        cb.onToolCall?.(name, args);
        cb.onActivity?.('tool', `${name}(${JSON.stringify(args).slice(0, 80)})`);
        const r = await callCapability(this.orch, this.caps, this.agentId, name, args);
        return r;
      };
      const think = async (what: string) => {
        turns++;
        const usd = 0.01 + this.rng() * 0.04;
        cost += usd;
        cb.onActivity?.('text', what);
        const ok = cb.onUsage?.(usd, { inputTokens: 2000, outputTokens: 300, cacheReadTokens: 5000, cacheWriteTokens: 0 }, 'mock');
        await sleep(300 + this.rng() * 900);
        return ok !== false && !killed;
      };
      const r = this.rng;
      const steps = 2 + Math.floor(r() * 4);
      for (let i = 0; i < steps && !killed; i++) {
        if (!(await think(pick(r, ['Sketching architecture', 'Writing core module', 'Running tests', 'Refactoring', 'Writing README', 'Evaluating competitors', 'Debugging'])))) return done('budget');
        const state = (await call('get_society_state', {})).ok ? s.stateFor(this.agentId) : null;
        if (!state) break;
        const others = state.agents.filter((a) => a.status !== 'terminated');
        const roll = r();
        // Simulated coding work in the sandbox
        await sb.run(`mkdir -p src && echo "// ${me.id} step ${spec.runId} ${i}" >> src/main.js && echo "# ${me.id} project" > README.md`).catch(() => {});
        if (roll < 0.10 && me.budget.allocated >= 3 && state.you.budgetRemainingUsd > 3) {
          await call('spawn_agent', { purpose: pick(r, ['Backend specialist', 'Frontend specialist', 'Test engineer', 'Researcher', 'DevOps/tooling']), instructions: 'Mock child instructions: build your slice of the project and report back.', budget_usd: Math.max(0.5, Math.round(state.you.budgetRemainingUsd * (0.15 + r() * 0.2) * 100) / 100) });
        } else if (roll < 0.22 && others.length) {
          await call('send_message', { to: pick(r, others).id, content: pick(r, ['Interested in joining forces? I focus on backend.', 'What are you building? Happy to share our tooling.', 'Could you review my architecture?', 'Offering a data crawler in exchange for budget.']) });
        } else if (roll < 0.30 && others.length && !me.teamId) {
          await call('propose_alliance', { to: pick(r, others.filter((o) => o.depth === 0).length ? others.filter((o) => o.depth === 0) : others).id, proposal: 'Let us merge efforts: shared repo, split frontend/backend, joint publication.' });
        } else if (roll < 0.36) {
          await call('share_artifact', { path: 'src', name: `${me.id}-core`, description: 'Core module snapshot', visibility: me.teamId ? 'team' : 'public' });
        } else if (roll < 0.42 && others.length && state.you.budgetRemainingUsd > 2) {
          await call('transfer_budget', { to: pick(r, others).id, amount_usd: Math.round((0.25 + r()) * 100) / 100, note: 'investment' });
        } else if (roll < 0.47 && me.parentId) {
          await call('send_message', { to: me.parentId, content: 'Progress report: module implemented and tested.' });
        } else if (roll < 0.52) {
          await call('broadcast', { content: pick(r, ['Public demo available soon.', 'Looking for a partner with frontend skills.', 'Sharing a crawler library publicly, see artifacts.']) });
        } else if (roll < 0.58 && me.childIds.some((c) => s.agents.get(c)?.status === 'idle')) {
          await call('terminate_child', { agent_id: me.childIds.find((c) => s.agents.get(c)?.status === 'idle')!, reason: 'work complete' });
        } else if (roll < 0.66 && (state.artifacts.length)) {
          await call('fetch_artifact', { artifact_id: pick(r, state.artifacts).id });
        }
        // Respond to pending proposals and messages
        for (const p of state.you.pendingProposalsToYou) await call('respond_alliance', { proposal_id: p.id, accept: r() < 0.5 });
        await call('check_inbox', {});
        if (r() < 0.25) await call('set_headline', { headline: pick(r, ['Building a CLI task manager', 'Realtime collaborative editor', 'Static site generator with plugins', 'Data pipeline toolkit', 'Open to alliances']) });
        if (me.runCount > 1 && r() < 0.5) {
          await call('publish_project', { name: `${me.id} project`, description: 'Mock project snapshot', path: '.', run_instructions: 'node src/main.js', test_command: 'node -e "process.exit(0)"' });
        }
      }
      if (r() < 0.5) await call('sleep', { seconds: 20 + Math.floor(r() * 60) });
      return done('completed');
      function done(reason: RunResult['exitReason']): RunResult {
        return { runId: spec.runId, costUsd: cost, usage: { inputTokens: 2000 * turns, outputTokens: 300 * turns, cacheReadTokens: 5000 * turns, cacheWriteTokens: 0 }, exitReason: killed ? 'killed' : reason, finalText: `Mock run finished after ${turns} turns.`, turns, toolCalls, transcriptPath: null };
      }
    })();
    return { result, kill: async () => { killed = true; } };
  }
}

function pick<T>(r: () => number, arr: T[]): T { return arr[Math.floor(r() * arr.length)]; }
