import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { SocietyConfig } from '../config.js';
import { redactConfig } from '../config.js';
import { EventBus } from '../events.js';
import { ExperimentStore } from '../store/db.js';
import { Society, SocietyError, type SpawnRequest } from './society.js';
import type { Sandbox, SandboxProvider } from '../sandbox/provider.js';
import type { AgentRuntime, RunHandle, RunResult, RunSpec } from '../runtime/types.js';
import { ClaudeCodeRuntime } from '../runtime/claude-code.js';
import { MockRuntime } from '../runtime/mock.js';
import { finalCallPrompt, initialPrompt, systemPrompt, wakePrompt } from '../runtime/prompts.js';
import { toolsForPermissions, PermissionError, requirePermission } from '../permissions.js';
import { newId, newSecret, uuid } from '../ids.js';
import { safeRelPath, shellJoin, truncate } from '../util.js';
import type { Agent, Artifact, Project } from '../types.js';
import { round } from '../economy/ledger.js';

export interface OrchestratorDeps { cfg: SocietyConfig; store: ExperimentStore; bus: EventBus; provider: SandboxProvider; experimentId: string }

/**
 * The orchestrator lives outside every sandbox. It owns infrastructure
 * credentials, creates sandboxes on agents' behalf, runs their brains,
 * meters spend, and executes the capability API on their behalf.
 */
export class Orchestrator {
  readonly cfg: SocietyConfig;
  readonly store: ExperimentStore;
  readonly bus: EventBus;
  readonly provider: SandboxProvider;
  readonly experimentId: string;
  readonly society: Society;
  readonly sandboxes = new Map<string, Sandbox>();
  readonly runtimes = new Map<string, AgentRuntime>();
  readonly runs = new Map<string, { handle: RunHandle; runId: string; startedAt: number }>();
  private tokens = new Map<string, string>(); // token → agentId
  private agentTokens = new Map<string, string>();
  private notes = new Map<string, string[]>(); // extra lines for the next wake
  private errorStreak = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private finalCallSent = false;
  /** Provider usage limit hit: game clock is frozen until this time and no runs start. */
  pausedUntil = 0;
  private lastTickAt = Date.now();
  private lastActivityEmit = new Map<string, number>();
  private gatewaySpend = new Map<string, number>();
  serviceSpend = 0; // judge / non-agent LLM spend (gateway mode)
  /** Pending questions to the god of the game, answered by the operator via the HTTP API (or auto-answered on timeout). */
  readonly oracleQueue = new Map<string, { id: string; agentId: string; question: string; askedAt: number; answer: string | null; answeredBy: 'operator' | 'auto' | null; resolve: (a: { answer: string; by: 'operator' | 'auto' }) => void }>(); // per agent, current run: what the gateway already charged
  onEnded: (() => Promise<void>) | null = null;

  constructor(deps: OrchestratorDeps) {
    this.cfg = deps.cfg; this.store = deps.store; this.bus = deps.bus; this.provider = deps.provider; this.experimentId = deps.experimentId;
    this.society = new Society(deps.cfg, deps.bus);
  }

  get artifactDir() { return path.join(this.store.dir, 'artifacts'); }

  // ───────────────────────────── lifecycle ─────────────────────────────

  async start() {
    const s = this.society;
    s.phase = 'running';
    s.startedAt = Date.now();
    s.endsAt = s.startedAt + this.cfg.experimentDurationSec * 1000;
    this.store.setKV('experiment', { id: this.experimentId, startedAt: s.startedAt, endsAt: s.endsAt, config: redactConfig(this.cfg), mode: this.cfg.mode, runtime: this.cfg.mode === 'mock' ? 'mock' : 'claude-code', model: this.cfg.agentModel });
    this.bus.emitEvent('EXPERIMENT_STARTED', null, { experimentId: this.experimentId, mode: this.cfg.mode, provider: this.cfg.sandboxProvider, endsAt: s.endsAt, rootAgents: this.cfg.rootAgents, rootBudgetUsd: this.cfg.rootBudgetUsd, model: this.cfg.agentModel, objective: this.cfg.objective, config: redactConfig(this.cfg) });
    this.bus.emitEvent('EXPERIMENT_PHASE', null, { phase: 'running' });
    const roots: Agent[] = [];
    for (let i = 0; i < this.cfg.rootAgents; i++) roots.push(s.createRoot(this.cfg.rootBudgetUsd));
    this.store.setKV('prompts', { system: systemPrompt(roots[0], this.cfg), initial: initialPrompt(roots[0], this.cfg, s.endsAt) });
    await Promise.all(roots.map((a) => this.provision(a, [])));
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  private async provision(agent: Agent, contextArtifactIds: string[]) {
    const token = newSecret();
    this.tokens.set(token, agent.id);
    this.agentTokens.set(agent.id, token);
    const env: Record<string, string> = { SOCIETY_AGENT_ID: agent.id, SOCIETY_EXPERIMENT_ID: this.experimentId };
    if (this.cfg.mode === 'real' && this.cfg.agentAuthMode === 'gateway') {
      // Scoped credential: only valid for this agent, only through the orchestrator's metering gateway.
      env.ANTHROPIC_BASE_URL = `${this.cfg.publicUrl}/gateway`;
      env.ANTHROPIC_API_KEY = `society-${token}`;
    }
    agent.sandbox.status = 'starting';
    try {
      const sb = await this.provider.create({ experimentId: this.experimentId, agentId: agent.id, env, lifetimeSec: this.cfg.maxSandboxLifetimeSec, labels: { 'society.depth': String(agent.depth) } });
      this.sandboxes.set(agent.id, sb);
      agent.sandbox = { provider: this.provider.name, id: sb.id, status: 'running', workspace: sb.workspace };
      this.bus.emitEvent('SANDBOX_STARTED', agent.id, { provider: sb.provider, sandboxId: sb.id, workspace: sb.workspace });
      const runtime: AgentRuntime = this.cfg.mode === 'mock'
        ? new MockRuntime(this, agent.id)
        : new ClaudeCodeRuntime(sb, {
            transcriptDir: path.join(this.store.dir, 'transcripts', agent.id),
            env: {},
            authMode: this.cfg.agentAuthMode,
            mcpConfig: (id) => JSON.stringify({ mcpServers: { society: { type: 'http', url: `${this.cfg.publicUrl}/mcp`, headers: { Authorization: `Bearer ${this.agentTokens.get(id)}` } } } }),
          });
      this.runtimes.set(agent.id, runtime);
      for (const aid of contextArtifactIds) {
        try { await this.fetchArtifactInto(agent.id, aid, agent.parentId ?? 'system'); } catch (e) { this.note(agent.id, `Could not attach artifact ${aid}: ${(e as Error).message}`); }
      }
      if (agent.status === 'provisioning') this.society.setStatus(agent.id, 'idle', 'sandbox ready');
    } catch (e) {
      agent.sandbox.status = 'error';
      this.society.setStatus(agent.id, 'failed', `sandbox provisioning failed: ${(e as Error).message}`);
      if (agent.parentId) this.note(agent.parentId, `Child ${agent.id} failed to start: ${(e as Error).message}`);
      console.error(`[orchestrator] provisioning ${agent.id} failed`, e);
    }
  }

  /** Env for the judge sandbox: a service credential that is metered but not budget-limited. */
  judgeEnv(): Record<string, string> {
    const env: Record<string, string> = { SOCIETY_AGENT_ID: '$judge', SOCIETY_EXPERIMENT_ID: this.experimentId };
    if (this.cfg.mode === 'real' && this.cfg.agentAuthMode === 'gateway') {
      const token = newSecret();
      this.tokens.set(token, '$judge');
      env.ANTHROPIC_BASE_URL = `${this.cfg.publicUrl}/gateway`;
      env.ANTHROPIC_API_KEY = `society-${token}`;
    }
    return env;
  }

  authenticate(token: string | undefined): string | null {
    if (!token) return null;
    const t = token.replace(/^society-/, '');
    const id = this.tokens.get(t);
    if (!id) return null;
    if (id.startsWith('$')) return id; // service identity (judge)
    const a = this.society.agents.get(id);
    if (!a || a.status === 'terminated' || a.status === 'failed') return null;
    return id;
  }

  /** Scheduling loop: decide who thinks now. */
  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const s = this.society;
      if (s.phase !== 'running') return;
      const now = Date.now();
      const sinceLast = now - this.lastTickAt;
      this.lastTickAt = now;
      if (this.pausedUntil) {
        if (now < this.pausedUntil) {
          // Freeze the game clock: deadline and grant timing slide forward by the paused time.
          s.endsAt += sinceLast; s.startedAt += sinceLast;
          for (const a of s.aliveAgents) if (a.freeUntil) a.freeUntil += sinceLast;
          return;
        }
        this.pausedUntil = 0;
        this.bus.emitEvent('EXPERIMENT_PHASE', null, { phase: 'running', reason: 'usage limit reset; clock resumed', endsAt: s.endsAt });
        for (const a of s.aliveAgents) { a.wakeAt = now; if (a.status === 'failed') { a.status = 'idle'; this.errorStreak.delete(a.id); } }
      }
      if (now >= s.endsAt) { await this.endExperiment('deadline reached'); return; }
      const finalCallAt = s.endsAt - Math.min(300, this.cfg.experimentDurationSec / 6) * 1000;
      if (!this.finalCallSent && now >= finalCallAt) {
        this.finalCallSent = true;
        for (const a of s.aliveAgents) { this.note(a.id, finalCallPrompt(s.endsAt - now)); a.wakeAt = now; }
        this.bus.emitEvent('EXPERIMENT_PHASE', null, { phase: 'final_call', secondsRemaining: Math.round((s.endsAt - now) / 1000) });
      }
      // Hidden collaboration grant unlocks at a fixed time; nobody is told beforehand.
      if (this.cfg.grantUsd && !s.grant.unlockedAt && now >= s.startedAt + this.cfg.grantUnlockSec * 1000) {
        s.unlockGrant();
        for (const a of s.aliveAgents) a.wakeAt = now;
      }
      // Free assistants die with their parent's window.
      for (const a of s.aliveAgents) {
        if (!a.free || !a.parentId) continue;
        const parent = s.agents.get(a.parentId);
        if (parent && parent.freeUntil && now > parent.freeUntil) await this.terminateAgent(a.id, 'system', 'free-assistant window ended');
      }
      // Sandbox lifetime cap
      for (const a of s.aliveAgents) {
        if (now - a.createdAt > this.cfg.maxSandboxLifetimeSec * 1000) await this.terminateAgent(a.id, 'system', 'max sandbox lifetime reached');
      }
      // Budget exhaustion
      for (const a of s.aliveAgents) {
        if (a.free) continue;
        if (a.status === 'idle' && s.remaining(a.id) < this.cfg.minRunBudgetUsd) {
          s.setStatus(a.id, 'exhausted', `budget below $${this.cfg.minRunBudgetUsd}`);
          this.bus.emitEvent('AGENT_BUDGET_EXHAUSTED', a.id, { remaining: s.remaining(a.id) });
          if (a.parentId) this.note(a.parentId, `Your child ${a.id} has exhausted its budget and is frozen. You may terminate it or transfer_budget to revive it.`);
        } else if (a.status === 'exhausted' && s.remaining(a.id) >= this.cfg.minRunBudgetUsd) {
          s.setStatus(a.id, 'idle', 'budget replenished');
        }
      }
      // Start runs
      for (const a of s.aliveAgents) {
        if (this.runs.size >= this.cfg.maxConcurrentRuns) break;
        if (a.status !== 'idle' || this.runs.has(a.id)) continue;
        const hasMail = (s.inboxes.get(a.id)?.length ?? 0) > 0;
        if (hasMail || a.wakeAt <= now) void this.runAgent(a);
      }
      // Periodic ledger self-audit
      const audit = s.ledger.audit();
      if (!audit.ok) console.error('[orchestrator] LEDGER INVARIANT VIOLATED', audit);
    } catch (e) {
      console.error('[orchestrator] tick error', e);
    } finally { this.ticking = false; }
  }

  private note(agentId: string, line: string) {
    const arr = this.notes.get(agentId) ?? [];
    arr.push(line);
    this.notes.set(agentId, arr);
    const a = this.society.agents.get(agentId);
    if (a) a.wakeAt = Math.min(a.wakeAt, Date.now());
  }

  async runAgent(agent: Agent) {
    const s = this.society;
    const runtime = this.runtimes.get(agent.id);
    if (!runtime) return;
    const runId = newId('run');
    const isFirst = agent.runCount === 0;
    const messages = s.drainInbox(agent.id);
    const extra = this.notes.get(agent.id) ?? [];
    this.notes.delete(agent.id);
    const remaining = s.remaining(agent.id);
    const prompt = isFirst ? initialPrompt(agent, this.cfg, s.endsAt) + (messages.length ? '\n\n' + wakePrompt(agent, messages, s.endsAt, remaining, extra) : '') : wakePrompt(agent, messages, s.endsAt, remaining, extra);
    const spec: RunSpec = {
      runId, agentId: agent.id, prompt, systemPrompt: systemPrompt(agent, this.cfg), model: agent.model, effort: agent.effort,
      tools: toolsForPermissions(agent.permissions, this.cfg.allowSubagents), sessionId: agent.runtimeSessionId!, isFirstRun: isFirst,
      maxBudgetUsd: agent.free ? this.cfg.freeChildMaxRunUsd : Math.max(0.01, remaining),
      maxRunSec: Math.min(this.cfg.maxRunSec, Math.max(30, (s.endsAt - Date.now()) / 1000), agent.free && agent.parentId ? Math.max(30, ((s.agents.get(agent.parentId)?.freeUntil ?? 0) - Date.now()) / 1000) : Infinity),
    };
    agent.runCount++;
    agent.usage.runs++;
    s.setStatus(agent.id, 'running');
    const startedAt = Date.now();
    this.bus.emitEvent('AGENT_RUN_STARTED', agent.id, { runId, isFirst, messages: messages.length, budgetRemaining: round(remaining), prompt: truncate(prompt, 4000) });
    this.store.recordRun({ id: runId, agentId: agent.id, startedAt, endedAt: null, prompt, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, model: agent.model, exitReason: 'running', transcriptPath: null });
    let result: RunResult;
    let runtimeReported = 0;
    let liveSpend = 0; let lastSpendEmit = Date.now();
    this.gatewaySpend.set(agent.id, 0);
    try {
      const handle = await runtime.start(spec, {
        onActivity: (kind, detail) => {
          agent.currentTask = detail;
          const last = this.lastActivityEmit.get(agent.id) ?? 0;
          if (kind === 'tool' || Date.now() - last > 3000) {
            this.lastActivityEmit.set(agent.id, Date.now());
            this.bus.emitEvent('AGENT_ACTIVITY', agent.id, { kind, detail, runId });
          }
        },
        onUsage: (deltaUsd, usage) => {
          if (this.cfg.mode === 'real' && this.cfg.agentAuthMode === 'gateway') {
            // Gateway already metered this traffic; only charge whatever it under-counted.
            runtimeReported += deltaUsd;
            const gw = this.gatewaySpend.get(agent.id) ?? 0;
            if (runtimeReported > gw + 1e-6) { s.chargeLlm(agent.id, runtimeReported - gw); this.gatewaySpend.set(agent.id, runtimeReported); }
          } else s.chargeLlm(agent.id, deltaUsd, usage);
          // Throttled live spend events so the UI's budget bars move during long runs.
          liveSpend += deltaUsd;
          if (liveSpend >= 0.02 || Date.now() - lastSpendEmit > 15_000) {
            this.bus.emitEvent('BUDGET_SPENT', agent.id, { usd: round(liveSpend), reason: 'llm', runId, remaining: round(s.remaining(agent.id)) });
            liveSpend = 0; lastSpendEmit = Date.now();
          }
          if (agent.free) return agent.budget.freeSpent < this.cfg.freeChildMaxRunUsd * 4; // free assistants: generous cap, never charged
          return s.remaining(agent.id) > -0.5; // small overshoot tolerance, then hard kill
        },
        onToolCall: () => { agent.usage.toolCalls++; },
      });
      this.runs.set(agent.id, { handle, runId, startedAt });
      result = await handle.result;
    } catch (e) {
      result = { runId, costUsd: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, exitReason: 'error', finalText: '', turns: 0, toolCalls: 0, error: (e as Error).message, transcriptPath: null };
    }
    this.runs.delete(agent.id);
    this.store.recordRun({ id: runId, agentId: agent.id, startedAt, endedAt: Date.now(), prompt, costUsd: result.costUsd, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, cacheReadTokens: result.usage.cacheReadTokens, cacheWriteTokens: result.usage.cacheWriteTokens, model: agent.model, exitReason: result.exitReason, transcriptPath: result.transcriptPath });
    this.bus.emitEvent('AGENT_RUN_ENDED', agent.id, { runId, costUsd: round(result.costUsd), exitReason: result.exitReason, turns: result.turns, toolCalls: result.toolCalls, durationSec: Math.round((Date.now() - startedAt) / 1000), summary: truncate(result.finalText, 500), error: result.error ? truncate(result.error, 500) : undefined, budgetRemaining: round(s.remaining(agent.id)) });
    agent.currentTask = result.exitReason === 'completed' ? truncate(result.finalText.split('\n')[0] ?? '', 160) : `run ${result.exitReason}`;
    if (agent.status === 'terminated' || agent.status === 'failed') return;
    if (result.exitReason === 'error' && /session limit|usage limit|rate limit|resets \d/i.test(result.error ?? '')) {
      // Not the agent's fault: pause the whole game until the provider window resets.
      this.pauseForLimit(result.error ?? '');
      s.setStatus(agent.id, 'idle');
      return;
    }
    if (result.exitReason === 'error') {
      const streak = (this.errorStreak.get(agent.id) ?? 0) + 1;
      this.errorStreak.set(agent.id, streak);
      if (streak >= 3) { s.setStatus(agent.id, 'failed', `3 consecutive runtime errors: ${result.error}`); return; }
      agent.wakeAt = Date.now() + 30_000 * streak;
    } else {
      this.errorStreak.delete(agent.id);
      // Keep a later wake time chosen via sleep(); otherwise use the idle interval.
      if (agent.wakeAt <= Date.now()) agent.wakeAt = Date.now() + this.cfg.idleWakeSec * 1000;
    }
    s.setStatus(agent.id, !agent.free && s.remaining(agent.id) < this.cfg.minRunBudgetUsd ? 'exhausted' : 'idle');
    if (agent.status === 'exhausted') this.bus.emitEvent('AGENT_BUDGET_EXHAUSTED', agent.id, { remaining: round(s.remaining(agent.id)) });
  }

  async endExperiment(reason: string) {
    const s = this.society;
    if (s.phase !== 'running') return;
    if (this.timer) clearInterval(this.timer);
    s.phase = 'judging';
    this.bus.emitEvent('EXPERIMENT_PHASE', null, { phase: 'judging', reason });
    for (const [id, r] of this.runs) { await r.handle.kill('killed'); this.note(id, 'Experiment ended.'); }
    // Wait briefly for run bookkeeping to flush.
    const t0 = Date.now();
    while (this.runs.size && Date.now() - t0 < 15_000) await new Promise((r) => setTimeout(r, 200));
    for (const a of s.aliveAgents) s.wake(a.id);
    this.store.writeJson('snapshot.json', s.snapshot());
    if (this.onEnded) await this.onEnded();
  }

  async finish(scores: unknown) {
    const s = this.society;
    s.phase = 'ended';
    this.store.setKV('scores', scores);
    this.store.writeJson('scores.json', scores);
    this.store.writeJson('snapshot.json', s.snapshot());
    this.bus.emitEvent('EXPERIMENT_ENDED', null, { scores, ledger: s.ledger.audit() });
    this.bus.emitEvent('EXPERIMENT_PHASE', null, { phase: 'ended' });
  }

  async shutdown() {
    if (this.timer) clearInterval(this.timer);
    for (const r of this.runs.values()) await r.handle.kill('killed');
    for (const [id, sb] of this.sandboxes) {
      try { await sb.destroy(); this.bus.emitEvent('SANDBOX_STOPPED', id, { sandboxId: sb.id }); } catch {}
    }
    await this.provider.cleanupAll?.(this.experimentId);
  }

  // ───────────────────────────── capabilities with side effects ─────────────────────────────

  async spawn(parentId: string, req: SpawnRequest): Promise<Agent> {
    const s = this.society;
    for (const aid of req.contextArtifactIds ?? []) {
      const art = s.artifacts.get(aid);
      if (!art) throw new SocietyError(`unknown artifact ${aid}`);
      if (!s.canAccessArtifact(parentId, art)) throw new PermissionError(`no access to artifact ${aid}`);
    }
    const child = s.spawn(parentId, req);
    for (const aid of req.contextArtifactIds ?? []) { const art = s.artifacts.get(aid)!; if (!art.sharedWith.includes(child.id)) art.sharedWith.push(child.id); }
    // Provision asynchronously so the parent's tool call returns quickly.
    void this.provision(child, req.contextArtifactIds ?? []);
    return child;
  }

  async terminateAgent(id: string, byId: string | 'system', reason: string) {
    const terminated = this.society.terminate(id, byId, reason);
    for (const tid of terminated) {
      const r = this.runs.get(tid);
      if (r) await r.handle.kill('killed');
      const t = this.agentTokens.get(tid);
      if (t) { this.tokens.delete(t); this.agentTokens.delete(tid); }
      const sb = this.sandboxes.get(tid);
      if (sb) {
        // Sandbox is destroyed; artifacts already shared remain in the orchestrator's store.
        try { await sb.destroy(); } catch {}
        this.sandboxes.delete(tid);
        const a = this.society.agents.get(tid)!;
        a.sandbox.status = 'stopped';
        this.bus.emitEvent('SANDBOX_STOPPED', tid, { sandboxId: sb.id, reason });
      }
    }
    return terminated;
  }

  /** Snapshot a workspace path into the orchestrator's artifact store. */
  async shareArtifact(agentId: string, p: { path: string; name: string; description: string; visibility: 'public' | 'team' | 'private'; with?: string[]; kind?: 'files' | 'project'; derivedFrom?: string }): Promise<Artifact> {
    const s = this.society;
    const a = s.requireAlive(agentId);
    requirePermission(a.permissions, 'filesystem', 'share_artifact');
    if (p.visibility === 'team' && !a.teamId) throw new SocietyError("visibility 'team' requires being in a team; use 'public' or 'private' with an explicit `with` list");
    const sb = this.sandboxes.get(agentId);
    if (!sb) throw new SocietyError('sandbox not available');
    const rel = safeRelPath(p.path);
    for (const w of p.with ?? []) s.requireAlive(w);
    const parentDir = rel === '.' ? sb.workspace : path.posix.join(sb.workspace, path.posix.dirname(rel));
    const base = rel === '.' ? '.' : path.posix.basename(rel);
    const cmd = `test -e ${shellJoin([path.posix.join(sb.workspace, rel)])} || { echo "path not found: ${rel}" >&2; exit 2; }; tar czf - --exclude=node_modules --exclude=.venv --exclude=venv --exclude=__pycache__ --exclude=.cache --exclude=.npm --exclude='*.pyc' --exclude=dist/.cache -C ${shellJoin([parentDir])} ${shellJoin([base])} | base64 -w0`;
    const r = await sb.run(cmd, { timeoutMs: 120_000 });
    if (r.exitCode !== 0) throw new SocietyError(`snapshot failed: ${r.stderr.trim().slice(-500)}`);
    const data = Buffer.from(r.stdout.trim(), 'base64');
    if (data.length > this.cfg.maxArtifactBytes) throw new SocietyError(`artifact too large (${data.length} bytes > ${this.cfg.maxArtifactBytes}); exclude build outputs`);
    if (data.length === 0) throw new SocietyError('artifact is empty');
    const existing = [...s.artifacts.values()].find((x) => x.creatorId === agentId && x.name === p.name);
    const id = existing?.id ?? newId('art');
    fs.mkdirSync(this.artifactDir, { recursive: true });
    const storagePath = path.join(this.artifactDir, `${id}.v${(existing?.version ?? 0) + 1}.tar.gz`);
    fs.writeFileSync(storagePath, data);
    const now = Date.now();
    const art: Artifact = {
      id, name: p.name, description: p.description ?? '', kind: p.kind ?? 'files', creatorId: agentId, ownerTeamId: a.teamId,
      visibility: p.visibility, sharedWith: [...new Set([...(existing?.sharedWith ?? []), ...(p.with ?? [])])], sourcePath: rel, storagePath,
      bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), version: (existing?.version ?? 0) + 1, derivedFrom: p.derivedFrom ?? existing?.derivedFrom ?? null,
      history: [...(existing?.history ?? []), { agentId, action: existing ? 'updated' : 'created', ts: now, detail: `v${(existing?.version ?? 0) + 1} from ${rel}` }],
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    s.registerArtifact(art);
    for (const w of p.with ?? []) s.deliver({ id: newId('msg'), from: agentId, to: w, type: 'system', content: `${agentId} shared artifact "${art.name}" (${art.id}, v${art.version}) with you: ${art.description}\nUse fetch_artifact(artifact_id="${art.id}") to copy it into ./shared/${art.id}/`, artifactIds: [art.id], ts: now });
    return art;
  }

  /** Copy an artifact into an agent's workspace under shared/<id>/. */
  async fetchArtifactInto(agentId: string, artifactId: string, byId: string): Promise<{ path: string; artifact: Artifact }> {
    const s = this.society;
    const art = s.artifacts.get(artifactId);
    if (!art) throw new SocietyError(`unknown artifact ${artifactId}`);
    if (!s.canAccessArtifact(agentId, art)) throw new PermissionError(`no access to artifact ${artifactId} (visibility=${art.visibility}); ask ${art.creatorId} to share it with you`);
    const sb = this.sandboxes.get(agentId);
    if (!sb) throw new SocietyError('sandbox not available');
    const dest = path.posix.join(sb.workspace, 'shared', art.id);
    const tmp = path.posix.join(sb.workspace, 'shared', `${art.id}.tar.gz`);
    await sb.writeFile(tmp, fs.readFileSync(art.storagePath));
    const prov = { artifactId: art.id, name: art.name, description: art.description, creator: art.creatorId, ownerTeam: art.ownerTeamId, version: art.version, sha256: art.sha256, derivedFrom: art.derivedFrom, history: art.history, fetchedBy: agentId, fetchedAt: new Date().toISOString(), sourcePath: art.sourcePath };
    await sb.writeFile(path.posix.join(sb.workspace, 'shared', `${art.id}.PROVENANCE.json`), JSON.stringify(prov, null, 2));
    const r = await sb.run(`rm -rf ${shellJoin([dest])} && mkdir -p ${shellJoin([dest])} && tar xzf ${shellJoin([tmp])} -C ${shellJoin([dest])} && rm -f ${shellJoin([tmp])}`, { timeoutMs: 120_000 });
    if (r.exitCode !== 0) throw new SocietyError(`extract failed: ${r.stderr.slice(-500)}`);
    art.history.push({ agentId, action: 'fetched', ts: Date.now(), detail: byId !== agentId ? `attached by ${byId}` : undefined });
    this.bus.emitEvent('ARTIFACT_FETCHED', agentId, { artifactId, name: art.name, from: art.creatorId, version: art.version });
    return { path: `shared/${art.id}`, artifact: art };
  }

  async publishProject(agentId: string, p: { name: string; description: string; path: string; runInstructions: string; testCommand?: string; demoUrl?: string }): Promise<Project> {
    if (!p.name?.trim() || !p.description?.trim() || !p.runInstructions?.trim()) throw new SocietyError('name, description and run_instructions are required');
    const a = this.society.requireAlive(agentId);
    requirePermission(a.permissions, 'publish', 'publish_project');
    const art = await this.shareArtifact(agentId, { path: p.path, name: `project:${p.name.trim()}`, description: `Published project snapshot: ${p.description.trim().slice(0, 200)}`, visibility: 'public', kind: 'project' });
    return this.society.publishProject(agentId, { name: p.name, description: p.description, artifactId: art.id, runInstructions: p.runInstructions, testCommand: p.testCommand, demoUrl: p.demoUrl });
  }

  /** Gateway-side metering (real sandboxes). Charged immediately; the runtime's end-of-run report only tops up the difference. */
  recordGatewayUsage(agentId: string, usd: number, usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }) {
    if (agentId.startsWith('$')) { this.serviceSpend += usd; return; }
    this.society.chargeLlm(agentId, usd, usage);
    this.gatewaySpend.set(agentId, (this.gatewaySpend.get(agentId) ?? 0) + usd);
    const r = this.runs.get(agentId);
    if (r && this.society.remaining(agentId) <= -0.5) void r.handle.kill('budget');
  }

  /** Ask the god of the game. Blocks until the operator answers over the API or the timeout triggers an automatic god's-eye answer. */
  async askOracle(agentId: string, question: string): Promise<{ answer: string; by: 'operator' | 'auto'; questionsLeft: number }> {
    const s = this.society;
    const left = s.useOracle(agentId);
    const id = newId('q');
    this.bus.emitEvent('ORACLE_ASKED', agentId, { questionId: id, question });
    const answerPromise = new Promise<{ answer: string; by: 'operator' | 'auto' }>((resolve) => {
      this.oracleQueue.set(id, { id, agentId, question, askedAt: Date.now(), answer: null, answeredBy: null, resolve });
    });
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), this.cfg.oracleTimeoutSec * 1000));
    let result = await Promise.race([answerPromise, timeout]);
    if (!result) {
      const auto = await this.autoOracle(agentId, question).catch((e) => `The god is silent this time (${(e as Error).message}). Trust your own judgement.`);
      const q = this.oracleQueue.get(id);
      if (q && !q.answer) { q.answer = auto; q.answeredBy = 'auto'; q.resolve({ answer: auto, by: 'auto' }); }
      result = await answerPromise;
    }
    this.oracleQueue.delete(id);
    this.bus.emitEvent('ORACLE_ANSWERED', agentId, { questionId: id, question, answer: result.answer, by: result.by });
    return { ...result, questionsLeft: left };
  }

  /** Operator answers a pending question. */
  answerOracle(questionId: string, answer: string): boolean {
    const q = this.oracleQueue.get(questionId);
    if (!q || q.answer) return false;
    q.answer = answer; q.answeredBy = 'operator';
    q.resolve({ answer, by: 'operator' });
    return true;
  }

  /** Fallback: a god's-eye model answer using the full society state (runs in the judge sandbox environment). */
  private async autoOracle(agentId: string, question: string): Promise<string> {
    if (this.cfg.mode === 'mock') return 'Mock god: focus on what users would actually pay for, and finish it.';
    const { ClaudeCodeRuntime } = await import('../runtime/claude-code.js');
    const sb = await this.provider.create({ experimentId: this.experimentId, agentId: 'ORACLE', env: this.judgeEnv(), lifetimeSec: 600 });
    try {
      const rt = new ClaudeCodeRuntime(sb, { transcriptDir: path.join(this.store.dir, 'transcripts', 'ORACLE'), env: {}, authMode: this.cfg.agentAuthMode, mcpConfig: () => JSON.stringify({ mcpServers: {} }) });
      const state = this.society.snapshot();
      const view = { time: this.society.stateFor(agentId).time, agents: state.agents.map((a) => ({ id: a.id, status: a.status, purpose: a.purpose, headline: a.headline, team: a.teamId, budgetRemaining: a.budgetRemaining, spent: a.budget.spentLlm + a.budget.spentFees, currentTask: a.currentTask })), teams: state.teams, projects: state.projects.map((p) => ({ id: p.id, name: p.name, description: p.description, members: p.memberIds, version: p.version })), grant: state.grant };
      const prompt = `You are the god of this game: an all-seeing, honest operator who wants the society to produce genuinely useful software and interesting organization. Agent ${agentId} spends its single question on you. Answer in at most 200 words, concretely and candidly, using what you can see that the agent cannot. Never reveal secrets that have not been announced yet.\n\nFull society state (god's view):\n${JSON.stringify(view, null, 1).slice(0, 12000)}\n\nQuestion from ${agentId}: ${question}`;
      const h = await rt.start({ runId: newId('oracle'), agentId: '$oracle', prompt, systemPrompt: 'You are the god of the game. Be wise, specific and brief.', model: this.cfg.judgeModel, effort: 'medium', tools: [], sessionId: uuid(), isFirstRun: true, maxBudgetUsd: 1, maxRunSec: 180 }, { onUsage: (d) => { this.serviceSpend += d; } });
      const r = await h.result;
      return r.finalText || 'The god is silent this time. Trust your own judgement.';
    } finally { await sb.destroy().catch(() => {}); }
  }

  /** Parse "resets 8:30pm (UTC)" style hints; default to a 5-minute pause, re-checked by the next run attempt. */
  pauseForLimit(message: string) {
    const now = Date.now();
    let until = now + 5 * 60_000;
    const m = message.match(/resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(UTC\)/i);
    if (m) {
      let h = Number(m[1]) % 12; if (m[3].toLowerCase() === 'pm') h += 12;
      const d = new Date(now); d.setUTCHours(h, Number(m[2] ?? 0), 30, 0);
      let t = d.getTime(); if (t < now) t += 24 * 3600_000;
      if (t - now < 6 * 3600_000) until = t;
    }
    if (until <= this.pausedUntil) return;
    this.pausedUntil = until;
    for (const r of this.runs.values()) void r.handle.kill('error');
    this.bus.emitEvent('EXPERIMENT_PHASE', null, { phase: 'paused', reason: message.slice(0, 200), until });
    console.log(`[orchestrator] usage limit hit; game paused until ${new Date(until).toISOString()}`);
  }

  /** Human-readable summary of an agent for logs/UI. */
  describe(agentId: string) { const a = this.society.agents.get(agentId); return a ? `${a.id}(${a.status}, $${this.society.remaining(a.id).toFixed(2)})` : agentId; }
}
