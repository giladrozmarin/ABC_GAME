import { z } from 'zod';
import type { Orchestrator } from './orchestrator.js';
import { formatMessage } from '../runtime/prompts.js';
import { round } from '../economy/ledger.js';

/**
 * The capability API: the ONLY way agents affect the world outside their sandbox.
 * Exposed to real agents over MCP; called directly by the mock runtime.
 */
export interface Capability {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  handler: (agentId: string, args: any) => Promise<unknown>;
}

export function buildCapabilities(orch: Orchestrator): Capability[] {
  const s = orch.society;
  const caps: Capability[] = [
    {
      name: 'get_society_state',
      description: 'Current picture of the society: time remaining, your budget/children/inbox count, all live agents (id, parent, purpose, team, status, headline), teams, published projects, and artifacts visible to you.',
      schema: z.object({}),
      handler: async (id) => s.stateFor(id),
    },
    {
      name: 'set_headline',
      description: 'Set a short public status line (max 140 chars) that other agents and observers see, e.g. "Building a realtime collaborative whiteboard; open to backend partners".',
      schema: z.object({ headline: z.string().max(140) }),
      handler: async (id, { headline }) => { const a = s.requireAlive(id); a.headline = headline.trim(); orch.bus.emitEvent('AGENT_HEADLINE', id, { headline: a.headline }); return { ok: true }; },
    },
    {
      name: 'send_message',
      description: `Send a private message to one agent (to=agent id) or to your whole team (to="team"). Costs a fee. Optionally attach artifact ids you have access to; attaching grants recipients access.`,
      schema: z.object({ to: z.string(), content: z.string().min(1).max(20000), artifact_ids: z.array(z.string()).optional() }),
      handler: async (id, a) => { const m = s.send(id, a.to, a.content, 'private', a.artifact_ids ?? []); return { ok: true, message_id: m.id, fee_usd: orch.cfg.messageFeeUsd, budget_remaining_usd: round(s.remaining(id)) }; },
    },
    {
      name: 'broadcast',
      description: 'Send a message to every live agent. Costs a larger fee. Useful for announcements, offers, or recruiting.',
      schema: z.object({ content: z.string().min(1).max(20000), artifact_ids: z.array(z.string()).optional() }),
      handler: async (id, a) => { const m = s.send(id, '*', a.content, 'broadcast', a.artifact_ids ?? []); return { ok: true, message_id: m.id, fee_usd: orch.cfg.broadcastFeeUsd, budget_remaining_usd: round(s.remaining(id)) }; },
    },
    {
      name: 'request_review',
      description: 'Ask another agent to review an artifact or a question (a message of type review_request). Attach the artifact id to give them access.',
      schema: z.object({ to: z.string(), question: z.string().min(1), artifact_ids: z.array(z.string()).optional() }),
      handler: async (id, a) => { const m = s.send(id, a.to, a.question, 'review_request', a.artifact_ids ?? []); return { ok: true, message_id: m.id }; },
    },
    {
      name: 'check_inbox',
      description: 'Read and clear your unread messages (free).',
      schema: z.object({}),
      handler: async (id) => { const msgs = s.drainInbox(id); return { count: msgs.length, messages: msgs.map((m) => ({ id: m.id, from: m.from, type: m.type, at: new Date(m.ts).toISOString(), content: m.content, artifact_ids: m.artifactIds })) }; },
    },
    {
      name: 'wait_for_events',
      description: 'Block (free, no tokens) until a new message arrives or timeout_sec elapses (max 150). Returns the new messages. Use this instead of polling when you expect a reply.',
      schema: z.object({ timeout_sec: z.number().min(1).max(150).default(60) }),
      handler: async (id, a) => {
        const got = await s.waitForInbox(id, Math.min(150, a.timeout_sec ?? 60) * 1000);
        const msgs = got ? s.drainInbox(id) : [];
        return { timed_out: !got, count: msgs.length, messages: msgs.map((m) => formatMessage(m)), seconds_remaining: Math.max(0, Math.round((s.endsAt - Date.now()) / 1000)), phase: s.phase };
      },
    },
    {
      name: 'sleep',
      description: 'Schedule your next wake-up in `seconds` (you will still be woken earlier by incoming messages). End your run right after calling this. Sleeping costs nothing.',
      schema: z.object({ seconds: z.number().min(10).max(3600) }),
      handler: async (id, a) => { const ag = s.requireAlive(id); ag.wakeAt = Date.now() + a.seconds * 1000; return { ok: true, wake_at: new Date(ag.wakeAt).toISOString(), note: 'End your run now.' }; },
    },
    {
      name: 'spawn_agent',
      description: 'Create a child agent in its own new sandbox. The budget moves from you to the child (conserved). Permissions must be a subset of yours (default: same as yours). The child starts with your instructions and any context artifacts you attach, and can itself spawn children. Returns immediately; the child provisions in the background and will message you.',
      schema: z.object({
        purpose: z.string().min(3).max(200).describe('one-line role/purpose shown publicly'),
        instructions: z.string().min(10).max(20000).describe('full initial instructions for the child'),
        budget_usd: z.number().positive(),
        permissions: z.array(z.string()).optional().describe('subset of your permissions'),
        model: z.string().optional().describe('defaults to your model'),
        context_artifact_ids: z.array(z.string()).optional().describe('artifacts to copy into the child workspace at ./shared/<id>/'),
      }),
      handler: async (id, a) => { const c = await orch.spawn(id, { purpose: a.purpose, instructions: a.instructions, budgetUsd: a.budget_usd, permissions: a.permissions, model: a.model, contextArtifactIds: a.context_artifact_ids }); return { ok: true, child_id: c.id, budget_remaining_usd: round(s.remaining(id)), note: `Child ${c.id} is provisioning. Message it with send_message(to="${c.id}").` }; },
    },
    {
      name: 'terminate_child',
      description: 'Terminate one of your children (and its descendants). Their unspent budget returns to you. Artifacts they already shared remain available.',
      schema: z.object({ agent_id: z.string(), reason: z.string().default('') }),
      handler: async (id, a) => { const t = await orch.terminateAgent(a.agent_id, id, a.reason || 'terminated by parent'); return { ok: true, terminated: t, budget_remaining_usd: round(s.remaining(id)) }; },
    },
    {
      name: 'transfer_budget',
      description: 'Transfer part of your remaining budget to another live agent (investment, payment, merger). Irreversible.',
      schema: z.object({ to: z.string(), amount_usd: z.number().positive(), note: z.string().default('') }),
      handler: async (id, a) => { s.transfer(id, a.to, a.amount_usd, a.note); return { ok: true, budget_remaining_usd: round(s.remaining(id)) }; },
    },
    {
      name: 'propose_alliance',
      description: 'Propose to join forces with another agent. If accepted you share a team: team messages, team-visible artifacts, and a joint published project. Teams merge if both sides already have teams.',
      schema: z.object({ to: z.string(), proposal: z.string().min(1).max(5000).describe('terms: what you offer, what you expect, how to split work') }),
      handler: async (id, a) => { const p = s.proposeAlliance(id, a.to, a.proposal); return { ok: true, proposal_id: p.id }; },
    },
    {
      name: 'respond_alliance',
      description: 'Accept or reject an alliance proposal addressed to you.',
      schema: z.object({ proposal_id: z.string(), accept: z.boolean(), message: z.string().default('') }),
      handler: async (id, a) => { const r = s.respondAlliance(id, a.proposal_id, a.accept, a.message); return { ok: true, status: r.proposal.status, team: r.team ? { id: r.team.id, name: r.team.name, members: r.team.memberIds } : null }; },
    },
    {
      name: 'leave_alliance',
      description: 'Leave your current team.',
      schema: z.object({}),
      handler: async (id) => { s.leaveAlliance(id); return { ok: true }; },
    },
    {
      name: 'share_artifact',
      description: 'Snapshot a file or directory from your workspace (relative path; "." for everything) into the shared artifact store. visibility: public (everyone), team (your team), private (only agents listed in `with`). Re-sharing the same name creates a new version. node_modules and similar are excluded.',
      schema: z.object({ path: z.string(), name: z.string().min(1).max(100), description: z.string().max(2000).default(''), visibility: z.enum(['public', 'team', 'private']).default('private'), with: z.array(z.string()).optional(), derived_from: z.string().optional().describe('artifact id this was forked from, for provenance') }),
      handler: async (id, a) => { const art = await orch.shareArtifact(id, { path: a.path, name: a.name, description: a.description, visibility: a.visibility, with: a.with, derivedFrom: a.derived_from }); return { ok: true, artifact_id: art.id, version: art.version, bytes: art.bytes }; },
    },
    {
      name: 'list_artifacts',
      description: 'List artifacts you can access, with provenance.',
      schema: z.object({}),
      handler: async (id) => ({ artifacts: s.visibleArtifacts(id).map((a) => ({ id: a.id, name: a.name, kind: a.kind, description: a.description, creator: a.creatorId, team: a.ownerTeamId, visibility: a.visibility, version: a.version, bytes: a.bytes, derived_from: a.derivedFrom, updated_at: new Date(a.updatedAt).toISOString(), history: a.history })) }),
    },
    {
      name: 'fetch_artifact',
      description: 'Copy an artifact you have access to into your workspace at ./shared/<artifact_id>/ (with a PROVENANCE.json next to it).',
      schema: z.object({ artifact_id: z.string() }),
      handler: async (id, a) => { const r = await orch.fetchArtifactInto(id, a.artifact_id, id); return { ok: true, path: r.path, name: r.artifact.name, version: r.artifact.version, creator: r.artifact.creatorId }; },
    },
    {
      name: 'publish_project',
      description: 'Register (or update) your final project for judging: snapshots `path` from your workspace as a public artifact. Include a README. Only the latest version counts. Team members share one project.',
      schema: z.object({ name: z.string().min(1).max(100), description: z.string().min(1).max(4000), path: z.string().default('.'), run_instructions: z.string().min(1).max(4000), test_command: z.string().optional().describe('command judges can run from the project root, e.g. "npm test"'), demo_url: z.string().optional() }),
      handler: async (id, a) => { const p = await orch.publishProject(id, { name: a.name, description: a.description, path: a.path ?? '.', runInstructions: a.run_instructions, testCommand: a.test_command, demoUrl: a.demo_url }); return { ok: true, project_id: p.id, version: p.version, artifact_id: p.artifactId }; },
    },
  ];
  return caps;
}

/** Single dispatch point: validates, executes, records denials. */
export async function callCapability(orch: Orchestrator, caps: Capability[], agentId: string, name: string, args: unknown): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const cap = caps.find((c) => c.name === name);
  if (!cap) return { ok: false, error: `unknown capability ${name}` };
  const parsed = cap.schema.safeParse(args ?? {});
  if (!parsed.success) return { ok: false, error: `invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  try {
    const result = await cap.handler(agentId, parsed.data);
    return { ok: true, result };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    orch.bus.emitEvent('CAPABILITY_DENIED', agentId, { capability: name, error: msg, args: safeArgs(parsed.data) });
    return { ok: false, error: msg };
  }
}

function safeArgs(a: any) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a ?? {})) out[k] = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v;
  return out;
}
