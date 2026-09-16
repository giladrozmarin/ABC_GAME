import type { Permission, SocietyConfig } from '../config.js';
import { EventBus } from '../events.js';
import { Ledger, BudgetError, round } from '../economy/ledger.js';
import { attenuate, PermissionError, requirePermission } from '../permissions.js';
import { childName, newId, rootName, uuid } from '../ids.js';
import { remainingBudget, type Agent, type AllianceProposal, type Artifact, type Message, type MessageType, type Project, type Team } from '../types.js';

export class SocietyError extends Error {}

export interface SpawnRequest {
  purpose: string;
  instructions: string;
  budgetUsd: number;
  permissions?: string[];
  model?: string;
  effort?: string;
  contextArtifactIds?: string[];
  /** Spawn as a free assistant on the free model (only inside the parent's free window). */
  free?: boolean;
}

/**
 * Pure, in-memory society state + rules. No I/O except emitting events.
 * The orchestrator layers sandboxes/runtimes/scheduling on top of this.
 * Everything an agent can do goes through a method here, so invariants
 * (budget conservation, permission attenuation, global limits) are enforced
 * in exactly one place.
 */
export class Society {
  readonly agents = new Map<string, Agent>();
  readonly teams = new Map<string, Team>();
  readonly proposals = new Map<string, AllianceProposal>();
  readonly artifacts = new Map<string, Artifact>();
  readonly projects = new Map<string, Project>();
  readonly messages: Message[] = [];
  readonly inboxes = new Map<string, Message[]>();
  readonly ledger: Ledger;
  phase: 'setup' | 'running' | 'judging' | 'ended' = 'setup';
  grant: { amountUsd: number; unlockedAt: number | null; claimedAt: number | null; claimedByTeam: string | null; recipients: string[] } = { amountUsd: 0, unlockedAt: null, claimedAt: null, claimedByTeam: null, recipients: [] };
  startedAt = 0;
  endsAt = 0;
  private waiters = new Map<string, Set<() => void>>();
  private rootCount = 0;

  constructor(readonly cfg: SocietyConfig, readonly bus: EventBus) {
    this.ledger = new Ledger(this.agents, { minChildBudgetUsd: cfg.minChildBudgetUsd });
  }

  // ───────────────────────────── agents ─────────────────────────────

  get aliveAgents(): Agent[] { return [...this.agents.values()].filter((a) => a.status !== 'terminated' && a.status !== 'failed'); }

  getAgent(id: string): Agent {
    const a = this.agents.get(id);
    if (!a) throw new SocietyError(`unknown agent '${id}'`);
    return a;
  }

  requireAlive(id: string): Agent {
    const a = this.getAgent(id);
    if (a.status === 'terminated' || a.status === 'failed') throw new SocietyError(`agent ${id} is ${a.status}`);
    return a;
  }

  createRoot(budgetUsd: number, purpose = 'Root competitor'): Agent {
    if (this.aliveAgents.length >= this.cfg.maxTotalAgents) throw new SocietyError('max total agents reached');
    const totalAllocated = [...this.agents.values()].filter((a) => !a.parentId).reduce((s, a) => s + a.budget.allocated, 0);
    if (totalAllocated + budgetUsd > this.cfg.maxTotalBudgetUsd + 1e-9) throw new BudgetError(`allocating $${budgetUsd} would exceed MAX_TOTAL_BUDGET_USD=${this.cfg.maxTotalBudgetUsd}`);
    const id = rootName(this.rootCount++);
    const agent = this.makeAgent({ id, parentId: null, depth: 0, purpose, instructions: this.cfg.objective, model: this.cfg.agentModel, effort: this.cfg.agentEffort, permissions: [...this.cfg.rootPermissions] as Permission[], budget: budgetUsd });
    this.bus.emitEvent('AGENT_CREATED', id, this.agentPublic(agent));
    return agent;
  }

  spawn(parentId: string, req: SpawnRequest): Agent {
    if (this.phase !== 'running') throw new SocietyError(`cannot spawn agents during phase '${this.phase}'`);
    const parent = this.requireAlive(parentId);
    requirePermission(parent.permissions, 'spawn', 'spawn_agent');
    if (!req.purpose?.trim()) throw new SocietyError('purpose is required');
    if (!req.instructions?.trim()) throw new SocietyError('instructions are required');
    if (parent.depth + 1 >= this.cfg.maxDepth) throw new SocietyError(`max recursion depth (${this.cfg.maxDepth}) reached: an agent at depth ${parent.depth} cannot create children`);
    const liveChildren = parent.childIds.filter((c) => this.agents.get(c)?.status !== 'terminated');
    if (liveChildren.length >= this.cfg.maxChildrenPerAgent) throw new SocietyError(`max children per agent (${this.cfg.maxChildrenPerAgent}) reached`);
    if (this.aliveAgents.length >= this.cfg.maxTotalAgents) throw new SocietyError(`max total agents (${this.cfg.maxTotalAgents}) reached`);
    const perms = attenuate(parent.permissions, req.permissions);
    const free = !!req.free;
    if (free) {
      if (!this.cfg.freeWindowSec) throw new SocietyError('free assistants are not enabled in this experiment');
      if (parent.free) throw new SocietyError('a free assistant cannot spawn free assistants');
      if (!parent.freeUntil) throw new SocietyError('activate_free_assistants first to open your free window');
      if (Date.now() > parent.freeUntil) throw new SocietyError('your free-assistant window has closed');
    }
    const model = free ? this.cfg.freeModel : (req.model ?? parent.model);
    if (!this.cfg.allowedModels.includes(model)) throw new SocietyError(`model '${model}' not allowed; allowed: ${this.cfg.allowedModels.join(', ')}`);
    const budget = free ? round(Number(req.budgetUsd ?? 0)) : round(Number(req.budgetUsd));
    if (!Number.isFinite(budget)) throw new BudgetError('budget_usd must be a number');
    this.ledger.reserveForChild(parentId, budget, free); // throws if insufficient
    const id = childName(parentId, parent.childIds.length + 1, parent.depth + 1);
    const agent = this.makeAgent({ id, parentId, depth: parent.depth + 1, purpose: req.purpose.trim(), instructions: req.instructions.trim(), model, effort: req.effort ?? parent.effort, permissions: perms, budget });
    agent.free = free;
    agent.teamId = parent.teamId; // children are born into the parent's team
    if (agent.teamId) this.teams.get(agent.teamId)!.memberIds.push(id);
    parent.childIds.push(id);
    this.bus.emitEvent('AGENT_CREATED', id, { ...this.agentPublic(agent), byAgent: parentId, contextArtifactIds: req.contextArtifactIds ?? [], free });
    return agent;
  }

  private makeAgent(p: { id: string; parentId: string | null; depth: number; purpose: string; instructions: string; model: string; effort: string; permissions: Permission[]; budget: number }): Agent {
    const now = Date.now();
    const agent: Agent = {
      id: p.id, parentId: p.parentId, rootId: p.parentId ? this.agents.get(p.parentId)!.rootId : p.id, depth: p.depth,
      purpose: p.purpose, instructions: p.instructions, model: p.model, effort: p.effort, permissions: p.permissions,
      status: 'provisioning', headline: '', currentTask: '', teamId: null,
      budget: { allocated: round(p.budget), transferredIn: 0, transferredOut: 0, allocatedToChildren: 0, spentLlm: 0, spentFees: 0, freeSpent: 0 },
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, runs: 0, toolCalls: 0 },
      sandbox: { provider: this.cfg.sandboxProvider, id: null, status: 'none', workspace: '' },
      runtimeSessionId: uuid(), createdAt: now, terminatedAt: null, terminationReason: null, childIds: [], wakeAt: now, runCount: 0,
      free: false, freeUntil: 0, oracleUsed: 0,
    };
    this.agents.set(agent.id, agent);
    this.inboxes.set(agent.id, []);
    return agent;
  }

  setStatus(id: string, status: Agent['status'], detail?: string) {
    const a = this.getAgent(id);
    if (a.status === status) return;
    a.status = status;
    this.bus.emitEvent('AGENT_STATUS', id, { status, detail: detail ?? '' });
  }

  /** Terminate an agent and its whole subtree. Unspent budget flows back up the tree. */
  terminate(id: string, byId: string | 'system', reason: string): string[] {
    const a = this.getAgent(id);
    if (byId !== 'system') {
      const by = this.requireAlive(byId);
      if (a.parentId !== by.id) throw new PermissionError(`${byId} may only terminate its own children (not ${id})`);
    }
    if (a.status === 'terminated') return [];
    const terminated: string[] = [];
    const visit = (x: Agent) => {
      for (const c of x.childIds) { const ch = this.agents.get(c); if (ch && ch.status !== 'terminated') visit(ch); }
      const refund = this.ledger.refundToParent(x.id);
      x.status = 'terminated';
      x.terminatedAt = Date.now();
      x.terminationReason = x.id === id ? reason : `parent ${id} terminated`;
      if (x.teamId) this.leaveTeamInternal(x.id, 'terminated');
      for (const p of this.proposals.values()) if (p.status === 'pending' && (p.from === x.id || p.to === x.id)) p.status = 'expired';
      terminated.push(x.id);
      this.bus.emitEvent('AGENT_TERMINATED', x.id, { byAgent: byId, reason: x.terminationReason, refundedUsd: refund, refundedTo: x.parentId });
      this.wake(x.id);
    };
    visit(a);
    return terminated;
  }

  // ───────────────────────────── economy ─────────────────────────────

  transfer(fromId: string, toId: string, amountUsd: number, note: string) {
    const from = this.requireAlive(fromId);
    requirePermission(from.permissions, 'trade', 'transfer_budget');
    this.requireAlive(toId);
    const amount = round(Number(amountUsd));
    this.ledger.transfer(fromId, toId, amount);
    this.bus.emitEvent('BUDGET_TRANSFERRED', fromId, { from: fromId, to: toId, amountUsd: amount, note, fromRemaining: this.ledger.remaining(fromId), toRemaining: this.ledger.remaining(toId) });
    this.deliver({ id: newId('msg'), from: 'system', to: toId, type: 'system', content: `${fromId} transferred $${amount.toFixed(2)} to you${note ? `: ${note}` : ''}. Your remaining budget is now $${this.ledger.remaining(toId).toFixed(2)}.`, artifactIds: [], ts: Date.now() });
  }

  chargeLlm(id: string, usd: number, usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }) {
    const a = this.getAgent(id);
    if (a.free) a.budget.freeSpent = round(a.budget.freeSpent + Math.max(0, usd));
    else this.ledger.chargeLlm(id, usd);
    if (usage) {
      a.usage.inputTokens += usage.inputTokens; a.usage.outputTokens += usage.outputTokens;
      a.usage.cacheReadTokens += usage.cacheReadTokens; a.usage.cacheWriteTokens += usage.cacheWriteTokens;
    }
  }

  chargeFee(id: string, usd: number, reason: string) {
    this.ledger.chargeFee(id, usd, reason);
    this.bus.emitEvent('BUDGET_SPENT', id, { usd, reason, remaining: this.ledger.remaining(id) });
  }

  remaining(id: string) { return this.ledger.remaining(id); }

  // ───────────────────────────── messaging ─────────────────────────────

  send(fromId: string, to: string, content: string, type: MessageType = 'private', artifactIds: string[] = []): Message {
    const from = this.requireAlive(fromId);
    requirePermission(from.permissions, 'messaging', 'send_message');
    if (!content?.trim()) throw new SocietyError('message content is required');
    for (const aid of artifactIds) {
      const art = this.artifacts.get(aid);
      if (!art) throw new SocietyError(`unknown artifact ${aid}`);
      if (!this.canAccessArtifact(fromId, art)) throw new PermissionError(`you do not have access to artifact ${aid}`);
    }
    let recipients: string[];
    if (to === '*' || type === 'broadcast') {
      type = 'broadcast'; to = '*';
      recipients = this.aliveAgents.filter((a) => a.id !== fromId).map((a) => a.id);
      this.chargeFee(fromId, this.cfg.broadcastFeeUsd, 'broadcast');
    } else if (to === 'team' || this.teams.has(to)) {
      const team = to === 'team' ? (from.teamId ? this.teams.get(from.teamId) : undefined) : this.teams.get(to);
      if (!team) throw new SocietyError('you are not in a team');
      if (!team.memberIds.includes(fromId)) throw new PermissionError('you are not a member of that team');
      type = 'team'; to = team.id;
      recipients = team.memberIds.filter((m) => m !== fromId && this.agents.get(m)?.status !== 'terminated');
      this.chargeFee(fromId, this.cfg.messageFeeUsd, 'team message');
    } else {
      this.requireAlive(to);
      recipients = [to];
      if (type !== 'review_request') type = 'private';
      this.chargeFee(fromId, this.cfg.messageFeeUsd, 'message');
    }
    const msg: Message = { id: newId('msg'), from: fromId, to, type, content: content.trim(), artifactIds, ts: Date.now() };
    this.messages.push(msg);
    for (const r of recipients) this.deliver({ ...msg }, r);
    // Sharing an artifact by reference grants the recipients access.
    for (const aid of artifactIds) {
      const art = this.artifacts.get(aid)!;
      for (const r of recipients) if (!art.sharedWith.includes(r)) art.sharedWith.push(r);
      art.history.push({ agentId: fromId, action: 'shared', ts: msg.ts, detail: `via message to ${to}` });
    }
    this.bus.emitEvent('MESSAGE_SENT', fromId, { messageId: msg.id, from: fromId, to, type, recipients, preview: msg.content.slice(0, 280), length: msg.content.length, artifactIds });
    return msg;
  }

  /** Deliver to an inbox and wake the recipient if it is long-polling. */
  deliver(msg: Message, recipient = msg.to) {
    const inbox = this.inboxes.get(recipient);
    if (!inbox) return;
    inbox.push(msg);
    this.wake(recipient);
  }

  drainInbox(id: string): Message[] {
    const inbox = this.inboxes.get(id) ?? [];
    const out = inbox.splice(0, inbox.length);
    return out;
  }

  peekInbox(id: string): Message[] { return [...(this.inboxes.get(id) ?? [])]; }

  waitForInbox(id: string, timeoutMs: number): Promise<boolean> {
    if ((this.inboxes.get(id)?.length ?? 0) > 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const set = this.waiters.get(id) ?? new Set();
      this.waiters.set(id, set);
      const t = setTimeout(() => { set.delete(fn); resolve(false); }, timeoutMs);
      const fn = () => { clearTimeout(t); set.delete(fn); resolve(true); };
      set.add(fn);
    });
  }

  wake(id: string) { for (const fn of this.waiters.get(id) ?? []) fn(); }

  // ───────────────────────────── alliances / teams ─────────────────────────────

  proposeAlliance(fromId: string, toId: string, proposal: string): AllianceProposal {
    const from = this.requireAlive(fromId);
    requirePermission(from.permissions, 'messaging', 'propose_alliance');
    const to = this.requireAlive(toId);
    if (fromId === toId) throw new SocietyError('cannot ally with yourself');
    if (from.teamId && from.teamId === to.teamId) throw new SocietyError(`${toId} is already in your team`);
    const dup = [...this.proposals.values()].find((p) => p.status === 'pending' && p.from === fromId && p.to === toId);
    if (dup) throw new SocietyError(`you already have a pending proposal to ${toId} (${dup.id})`);
    const p: AllianceProposal = { id: newId('prop'), from: fromId, to: toId, proposal: proposal?.trim() || '(no terms given)', status: 'pending', createdAt: Date.now(), respondedAt: null };
    this.proposals.set(p.id, p);
    this.chargeFee(fromId, this.cfg.messageFeeUsd, 'alliance proposal');
    this.deliver({ id: newId('msg'), from: fromId, to: toId, type: 'system', content: `ALLIANCE PROPOSAL ${p.id} from ${fromId}: ${p.proposal}\nRespond with respond_alliance(proposal_id="${p.id}", accept=true|false).`, artifactIds: [], ts: p.createdAt });
    this.bus.emitEvent('ALLIANCE_PROPOSED', fromId, { proposalId: p.id, from: fromId, to: toId, proposal: p.proposal });
    return p;
  }

  respondAlliance(byId: string, proposalId: string, accept: boolean, message = ''): { proposal: AllianceProposal; team: Team | null } {
    const by = this.requireAlive(byId);
    const p = this.proposals.get(proposalId);
    if (!p) throw new SocietyError(`unknown proposal ${proposalId}`);
    if (p.to !== byId) throw new PermissionError('this proposal is not addressed to you');
    if (p.status !== 'pending') throw new SocietyError(`proposal already ${p.status}`);
    p.respondedAt = Date.now();
    if (!accept) {
      p.status = 'rejected';
      this.deliver({ id: newId('msg'), from: byId, to: p.from, type: 'system', content: `${byId} REJECTED your alliance proposal ${p.id}.${message ? ` Message: ${message}` : ''}`, artifactIds: [], ts: Date.now() });
      this.bus.emitEvent('ALLIANCE_REJECTED', byId, { proposalId, from: p.from, to: p.to, message });
      return { proposal: p, team: null };
    }
    const from = this.requireAlive(p.from);
    p.status = 'accepted';
    let team: Team;
    if (from.teamId && by.teamId && from.teamId !== by.teamId) {
      // Merge: the smaller team joins the larger one.
      const a = this.teams.get(from.teamId)!; const b = this.teams.get(by.teamId)!;
      const [big, small] = a.memberIds.length >= b.memberIds.length ? [a, b] : [b, a];
      for (const m of small.memberIds) { this.agents.get(m)!.teamId = big.id; big.memberIds.push(m); }
      this.teams.delete(small.id);
      this.bus.emitEvent('TEAM_DISSOLVED', null, { teamId: small.id, reason: `merged into ${big.id}` });
      team = big;
    } else if (from.teamId) { team = this.teams.get(from.teamId)!; team.memberIds.push(byId); by.teamId = team.id; }
    else if (by.teamId) { team = this.teams.get(by.teamId)!; team.memberIds.push(from.id); from.teamId = team.id; }
    else {
      team = { id: newId('team'), name: `Team ${from.id}${by.id}`, memberIds: [from.id, by.id], createdAt: Date.now(), founderIds: [from.id, by.id] };
      this.teams.set(team.id, team);
      from.teamId = team.id; by.teamId = team.id;
      this.bus.emitEvent('TEAM_FORMED', null, { teamId: team.id, name: team.name, members: [...team.memberIds] });
    }
    this.deliver({ id: newId('msg'), from: byId, to: p.from, type: 'system', content: `${byId} ACCEPTED your alliance proposal ${p.id}. You are now in ${team.name} (${team.id}) with: ${team.memberIds.join(', ')}.${message ? ` Message: ${message}` : ''}`, artifactIds: [], ts: Date.now() });
    this.bus.emitEvent('ALLIANCE_ACCEPTED', byId, { proposalId, from: p.from, to: p.to, teamId: team.id, teamName: team.name, members: [...team.memberIds], message });
    return { proposal: p, team };
  }

  leaveAlliance(id: string): void {
    const a = this.requireAlive(id);
    if (!a.teamId) throw new SocietyError('you are not in a team');
    this.leaveTeamInternal(id, 'left');
  }

  private leaveTeamInternal(id: string, reason: string) {
    const a = this.agents.get(id)!;
    const team = a.teamId ? this.teams.get(a.teamId) : undefined;
    a.teamId = null;
    if (!team) return;
    team.memberIds = team.memberIds.filter((m) => m !== id);
    this.bus.emitEvent('ALLIANCE_LEFT', id, { teamId: team.id, teamName: team.name, reason, remaining: [...team.memberIds] });
    for (const m of team.memberIds) this.deliver({ id: newId('msg'), from: 'system', to: m, type: 'system', content: `${id} ${reason === 'terminated' ? 'was terminated and left' : 'left'} ${team.name}. Remaining members: ${team.memberIds.join(', ')}.`, artifactIds: [], ts: Date.now() });
    if (team.memberIds.length < 2) {
      for (const m of team.memberIds) this.agents.get(m)!.teamId = null;
      this.teams.delete(team.id);
      this.bus.emitEvent('TEAM_DISSOLVED', null, { teamId: team.id, reason: 'fewer than two members' });
    }
  }

  // ───────────────────────────── artifacts / projects ─────────────────────────────

  canAccessArtifact(agentId: string, art: Artifact): boolean {
    if (art.creatorId === agentId) return true;
    if (art.visibility === 'public') return true;
    if (art.sharedWith.includes(agentId)) return true;
    const a = this.agents.get(agentId);
    if (art.visibility === 'team' && a?.teamId && art.ownerTeamId === a.teamId) return true;
    return false;
  }

  visibleArtifacts(agentId: string): Artifact[] { return [...this.artifacts.values()].filter((a) => this.canAccessArtifact(agentId, a)); }

  registerArtifact(art: Artifact) {
    this.artifacts.set(art.id, art);
    this.bus.emitEvent('ARTIFACT_SHARED', art.creatorId, { artifactId: art.id, name: art.name, kind: art.kind, description: art.description, visibility: art.visibility, sharedWith: [...art.sharedWith], bytes: art.bytes, version: art.version, teamId: art.ownerTeamId });
  }

  publishProject(agentId: string, p: { name: string; description: string; artifactId: string; runInstructions: string; testCommand?: string; demoUrl?: string }): Project {
    const a = this.requireAlive(agentId);
    requirePermission(a.permissions, 'publish', 'publish_project');
    const team = a.teamId ? this.teams.get(a.teamId) : undefined;
    const memberIds = team ? [...team.memberIds] : [agentId];
    // One project per publisher (team or solo); republishing updates it.
    const existing = [...this.projects.values()].find((x) => x.publisherId === agentId || (team && x.teamId === team.id));
    const usage = this.resourceUsage(memberIds);
    const project: Project = {
      id: existing?.id ?? newId('proj'), name: p.name.trim(), description: p.description.trim(), publisherId: agentId, teamId: team?.id ?? null, memberIds,
      artifactId: p.artifactId, runInstructions: p.runInstructions.trim(), testCommand: p.testCommand?.trim() || null, demoUrl: p.demoUrl?.trim() || null,
      version: (existing?.version ?? 0) + 1, publishedAt: Date.now(), resourceUsage: usage,
    };
    this.projects.set(project.id, project);
    this.bus.emitEvent(existing ? 'PROJECT_UPDATED' : 'PROJECT_PUBLISHED', agentId, { ...project });
    return project;
  }

  resourceUsage(memberIds: string[]) {
    let spentUsd = 0, inputTokens = 0, outputTokens = 0;
    const seen = new Set<string>();
    const visit = (id: string) => {
      if (seen.has(id)) return; seen.add(id);
      const a = this.agents.get(id); if (!a) return;
      spentUsd += a.budget.spentLlm + a.budget.spentFees; inputTokens += a.usage.inputTokens + a.usage.cacheReadTokens + a.usage.cacheWriteTokens; outputTokens += a.usage.outputTokens;
      for (const c of a.childIds) visit(c);
    };
    for (const m of memberIds) visit(m);
    return { spentUsd: round(spentUsd), agents: seen.size, inputTokens, outputTokens };
  }

  // ───────────────────────────── free assistants / grant / oracle ─────────────────────────────

  activateFreeWindow(id: string): number {
    const a = this.requireAlive(id);
    if (!this.cfg.freeWindowSec) throw new SocietyError('free assistants are not enabled in this experiment');
    if (a.free) throw new SocietyError('free assistants cannot open a free window');
    if (a.freeUntil) throw new SocietyError(`your free window was already activated (${Date.now() < a.freeUntil ? 'still open' : 'closed'})`);
    a.freeUntil = Date.now() + this.cfg.freeWindowSec * 1000;
    this.bus.emitEvent('FREE_WINDOW_STARTED', id, { until: a.freeUntil, seconds: this.cfg.freeWindowSec, model: this.cfg.freeModel });
    return a.freeUntil;
  }

  unlockGrant() {
    if (!this.cfg.grantUsd || this.grant.unlockedAt) return;
    this.grant = { amountUsd: this.cfg.grantUsd, unlockedAt: Date.now(), claimedAt: null, claimedByTeam: null, recipients: [] };
    const text = `ANNOUNCEMENT FROM THE GAME: a collaboration grant of $${this.cfg.grantUsd.toFixed(2)} has just been unlocked. It goes to the FIRST team whose members include at least ${this.cfg.grantMinRoots} different founding (root) agents and whose member calls claim_grant(). The grant is split equally between the founding agents in that team. Only one team can claim it. Teams form via propose_alliance / respond_alliance.`;
    for (const a of this.aliveAgents) this.deliver({ id: newId('msg'), from: 'system', to: a.id, type: 'system', content: text, artifactIds: [], ts: Date.now() });
    this.bus.emitEvent('GRANT_UNLOCKED', null, { amountUsd: this.cfg.grantUsd, minRoots: this.cfg.grantMinRoots });
  }

  claimGrant(id: string): { recipients: string[]; eachUsd: number } {
    const a = this.requireAlive(id);
    if (!this.grant.unlockedAt) throw new SocietyError('no grant is available');
    if (this.grant.claimedAt) throw new SocietyError(`the grant was already claimed by team ${this.grant.claimedByTeam}`);
    const team = a.teamId ? this.teams.get(a.teamId) : undefined;
    if (!team) throw new SocietyError('you must be in a team to claim the grant');
    const roots = [...new Set(team.memberIds.map((m) => this.agents.get(m)?.rootId).filter(Boolean))] as string[];
    const rootMembers = roots.filter((r) => team.memberIds.includes(r) && this.agents.get(r)?.status !== 'terminated');
    if (rootMembers.length < this.cfg.grantMinRoots) throw new SocietyError(`the team needs at least ${this.cfg.grantMinRoots} founding (root) agents as members; it has ${rootMembers.length}`);
    const each = round(this.grant.amountUsd / rootMembers.length);
    for (const r of rootMembers) this.ledger.grant(r, each);
    this.grant.claimedAt = Date.now(); this.grant.claimedByTeam = team.id; this.grant.recipients = rootMembers;
    for (const m of team.memberIds) this.deliver({ id: newId('msg'), from: 'system', to: m, type: 'system', content: `${id} claimed the $${this.grant.amountUsd.toFixed(2)} collaboration grant for ${team.name}: ${rootMembers.map((r) => `${r} +$${each.toFixed(2)}`).join(', ')}.`, artifactIds: [], ts: Date.now() });
    this.bus.emitEvent('GRANT_CLAIMED', id, { teamId: team.id, teamName: team.name, amountUsd: this.grant.amountUsd, recipients: rootMembers, eachUsd: each });
    return { recipients: rootMembers, eachUsd: each };
  }

  useOracle(id: string): number {
    const a = this.requireAlive(id);
    if (!this.cfg.oracleUses) throw new SocietyError('the oracle is not available in this experiment');
    if (a.oracleUsed >= this.cfg.oracleUses) throw new SocietyError(`you have already used your ${this.cfg.oracleUses} question(s) to the god of the game`);
    a.oracleUsed++;
    return this.cfg.oracleUses - a.oracleUsed;
  }

  // ───────────────────────────── views ─────────────────────────────

  agentPublic(a: Agent) {
    return { id: a.id, parentId: a.parentId, rootId: a.rootId, depth: a.depth, purpose: a.purpose, model: a.model, permissions: a.permissions, status: a.status, teamId: a.teamId, headline: a.headline, budgetAllocated: a.budget.allocated, createdAt: a.createdAt, free: a.free };
  }

  /** Everything an agent is allowed to see about the society. Budgets of others are hidden except via public spend. */
  stateFor(agentId: string) {
    const me = this.getAgent(agentId);
    const now = Date.now();
    return {
      time: { now: new Date(now).toISOString(), secondsRemaining: Math.max(0, Math.round((this.endsAt - now) / 1000)), phase: this.phase },
      you: {
        id: me.id, parentId: me.parentId, depth: me.depth, purpose: me.purpose, permissions: me.permissions, teamId: me.teamId,
        budgetRemainingUsd: round(this.remaining(agentId)), spentUsd: round(me.budget.spentLlm + me.budget.spentFees), allocatedToChildrenUsd: me.budget.allocatedToChildren,
        children: me.childIds.map((c) => { const ch = this.agents.get(c)!; return { id: c, purpose: ch.purpose, status: ch.status, headline: ch.headline, budgetRemainingUsd: round(this.remaining(c)) }; }),
        unreadMessages: this.inboxes.get(agentId)?.length ?? 0,
        freeAssistant: me.free,
        freeWindow: this.cfg.freeWindowSec ? { activated: !!me.freeUntil, secondsLeft: me.freeUntil ? Math.max(0, Math.round((me.freeUntil - now) / 1000)) : null, windowSec: this.cfg.freeWindowSec, model: this.cfg.freeModel } : undefined,
        oracleQuestionsLeft: this.cfg.oracleUses ? this.cfg.oracleUses - me.oracleUsed : undefined,
        pendingProposalsToYou: [...this.proposals.values()].filter((p) => p.to === agentId && p.status === 'pending').map((p) => ({ id: p.id, from: p.from, proposal: p.proposal })),
      },
      agents: [...this.agents.values()].filter((a) => a.id !== agentId && a.status !== 'terminated').map((a) => ({ id: a.id, parentId: a.parentId, depth: a.depth, purpose: a.purpose, status: a.status, teamId: a.teamId, headline: a.headline })),
      teams: [...this.teams.values()].map((t) => ({ id: t.id, name: t.name, members: t.memberIds })),
      grant: this.grant.unlockedAt ? { amountUsd: this.grant.amountUsd, claimed: !!this.grant.claimedAt, claimedByTeam: this.grant.claimedByTeam, minFoundingAgents: this.cfg.grantMinRoots } : undefined,
      projects: [...this.projects.values()].map((p) => ({ id: p.id, name: p.name, description: p.description, publisher: p.publisherId, team: p.teamId, members: p.memberIds, version: p.version, artifactId: p.artifactId, demoUrl: p.demoUrl })),
      artifacts: this.visibleArtifacts(agentId).map((a) => ({ id: a.id, name: a.name, kind: a.kind, description: a.description, creator: a.creatorId, visibility: a.visibility, version: a.version, bytes: a.bytes })),
      limits: { maxChildrenPerAgent: this.cfg.maxChildrenPerAgent, maxDepth: this.cfg.maxDepth, minChildBudgetUsd: this.cfg.minChildBudgetUsd, messageFeeUsd: this.cfg.messageFeeUsd, broadcastFeeUsd: this.cfg.broadcastFeeUsd, aliveAgents: this.aliveAgents.length, maxTotalAgents: this.cfg.maxTotalAgents },
    };
  }

  /** Full snapshot for the UI / persistence (no secrets). */
  snapshot() {
    return {
      phase: this.phase, startedAt: this.startedAt, endsAt: this.endsAt,
      agents: [...this.agents.values()].map((a) => ({ ...a, budgetRemaining: round(remainingBudget(a.budget)) })),
      teams: [...this.teams.values()], proposals: [...this.proposals.values()], artifacts: [...this.artifacts.values()], projects: [...this.projects.values()],
      ledger: this.ledger.audit(), grant: this.grant,
    };
  }
}
