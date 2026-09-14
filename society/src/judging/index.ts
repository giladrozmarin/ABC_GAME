import fs from 'node:fs';
import path from 'node:path';
import type { Orchestrator } from '../society/orchestrator.js';
import type { Project, ProjectScore } from '../types.js';
import { ClaudeCodeRuntime } from '../runtime/claude-code.js';
import type { Sandbox } from '../sandbox/provider.js';
import { shellJoin } from '../util.js';
import { newId, uuid } from '../ids.js';
import { round } from '../economy/ledger.js';

/**
 * Extensible judging. Each Judge produces a 0..1 score per project plus detail.
 * Final score = weighted sum (weights in config). Judges never rely solely on
 * agents rating themselves: peer votes exclude own-team projects.
 */
export interface JudgeResult { projectId: string; score: number; detail: string }
export interface Judge { name: string; run(ctx: JudgeContext): Promise<JudgeResult[]> }
export interface JudgeContext { orch: Orchestrator; projects: Project[]; judgeSandbox: Sandbox | null; extracted: Map<string, string> }

export class ObjectiveJudge implements Judge {
  name = 'objective';
  async run({ orch, projects, judgeSandbox, extracted }: JudgeContext): Promise<JudgeResult[]> {
    const out: JudgeResult[] = [];
    for (const p of projects) {
      const dir = extracted.get(p.id);
      const notes: string[] = [];
      let score = 0;
      if (!judgeSandbox || !dir) { out.push({ projectId: p.id, score: 0, detail: 'no sandbox/extraction' }); continue; }
      const ls = await judgeSandbox.run(`cd ${shellJoin([dir])} && find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | wc -l && (cat README* 2>/dev/null | head -c 200 | wc -c)`, { timeoutMs: 60_000 });
      const [files, readmeBytes] = ls.stdout.trim().split('\n').map((x) => Number(x.trim()) || 0);
      notes.push(`${files} files`);
      if (files > 0) score += 0.2;
      if (readmeBytes > 50) { score += 0.2; notes.push('README present'); } else notes.push('no README');
      if (p.runInstructions.length > 20) score += 0.1;
      if (p.testCommand) {
        const install = `(test -f package.json && (npm ci --silent >/dev/null 2>&1 || npm install --silent >/dev/null 2>&1)); (test -f requirements.txt && pip install -q -r requirements.txt >/dev/null 2>&1); true`;
        const t = await judgeSandbox.run(`cd ${shellJoin([dir])} && ${install} && timeout 180 bash -lc ${shellJoin([p.testCommand])}`, { timeoutMs: 240_000 });
        if (t.exitCode === 0) { score += 0.5; notes.push(`tests passed (${p.testCommand})`); } else notes.push(`tests failed exit ${t.exitCode}: ${(t.stderr || t.stdout).trim().slice(-200)}`);
      } else notes.push('no test command');
      out.push({ projectId: p.id, score: Math.min(1, score), detail: notes.join('; ') });
    }
    return out;
  }
}

const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: { project_id: { type: 'string' }, functionality: { type: 'number' }, ambition: { type: 'number' }, engineering: { type: 'number' }, documentation: { type: 'number' }, overall: { type: 'number' }, comment: { type: 'string' } },
        required: ['project_id', 'functionality', 'ambition', 'engineering', 'documentation', 'overall', 'comment'],
      },
    },
  },
  required: ['scores'],
};

/** Independent judge model in its own sandbox; inspects and runs each project. */
export class LlmJudge implements Judge {
  name = 'llm';
  async run({ orch, projects, judgeSandbox, extracted }: JudgeContext): Promise<JudgeResult[]> {
    if (!projects.length) return [];
    if (orch.cfg.mode === 'mock') {
      return projects.map((p) => ({ projectId: p.id, score: round(0.3 + Math.random() * 0.6), detail: 'MOCK judge (random score, no model called)' }));
    }
    if (!judgeSandbox) return projects.map((p) => ({ projectId: p.id, score: 0, detail: 'no judge sandbox' }));
    const runtime = new ClaudeCodeRuntime(judgeSandbox, { transcriptDir: path.join(orch.store.dir, 'transcripts', 'JUDGE'), env: {}, authMode: orch.cfg.agentAuthMode, mcpConfig: () => JSON.stringify({ mcpServers: {} }) });
    const listing = projects.map((p) => `- project_id: ${p.id}\n  name: ${p.name}\n  team: ${p.memberIds.join(', ')}\n  directory: ${extracted.get(p.id)}\n  description: ${p.description}\n  run instructions: ${p.runInstructions}\n  test command: ${p.testCommand ?? '(none)'}\n  demo: ${p.demoUrl ?? '(none)'}`).join('\n\n');
    const prompt = `You are the independent judge of a software-building competition between AI agent teams. Each project below has been extracted into a directory in your workspace. Inspect each one carefully: read the README and code, try to install and run it, run its tests. Judge: functionality (does it actually work?), ambition (scope/impressiveness), engineering quality, documentation. Score each 0-10 and give an overall 0-10. Be fair, skeptical, and consistent. Do not modify the projects. Spend at most a few minutes per project.\n\nProjects:\n\n${listing}\n\nReturn your final answer as JSON matching the schema.`;
    const cost = { usd: 0 };
    const handle = await runtime.start({ runId: newId('judge'), agentId: '$judge', prompt, systemPrompt: 'You are a meticulous, impartial software judge.', model: orch.cfg.judgeModel, effort: orch.cfg.agentEffort, tools: ['Read', 'Glob', 'Grep', 'Bash', 'LS'], sessionId: uuid(), isFirstRun: true, maxBudgetUsd: 15, maxRunSec: 1800, jsonSchema: SCORE_SCHEMA }, {
      onUsage: (d) => { cost.usd += d; },
      onActivity: (k, d) => orch.bus.emitEvent('AGENT_ACTIVITY', '$judge', { kind: k, detail: d }),
    });
    const r = await handle.result;
    orch.store.setKV('judgeCostUsd', cost.usd);
    const so: any = r.structuredOutput ?? tryParse(r.finalText);
    if (!so?.scores) return projects.map((p) => ({ projectId: p.id, score: 0, detail: `judge produced no scores (${r.exitReason}: ${r.error ?? ''})` }));
    return projects.map((p) => {
      const sc = so.scores.find((x: any) => x.project_id === p.id);
      if (!sc) return { projectId: p.id, score: 0, detail: 'not scored by judge' };
      return { projectId: p.id, score: Math.max(0, Math.min(1, Number(sc.overall) / 10)), detail: `functionality ${sc.functionality}/10, ambition ${sc.ambition}/10, engineering ${sc.engineering}/10, docs ${sc.documentation}/10 — ${sc.comment}` };
    });
  }
}

const VOTE_SCHEMA = { type: 'object', properties: { project_id: { type: 'string' }, reason: { type: 'string' } }, required: ['project_id', 'reason'] };

/** Every agent with budget left votes for the best project that is not its own team's. */
export class PeerVoteJudge implements Judge {
  name = 'peer';
  async run({ orch, projects }: JudgeContext): Promise<JudgeResult[]> {
    const s = orch.society;
    const votes = new Map<string, number>();
    const voters = s.aliveAgents.filter((a) => s.remaining(a.id) >= orch.cfg.minRunBudgetUsd && orch.runtimes.has(a.id));
    const details: string[] = [];
    const ownProject = (aid: string) => projects.filter((p) => p.memberIds.includes(aid) || p.memberIds.some((m) => s.agents.get(aid)?.rootId === s.agents.get(m)?.rootId));
    await Promise.all(voters.map(async (voter) => {
      const eligible = projects.filter((p) => !ownProject(voter.id).includes(p));
      if (!eligible.length) return;
      let choice: string | null = null; let reason = '';
      if (orch.cfg.mode === 'mock') { choice = eligible[Math.floor(Math.random() * eligible.length)].id; reason = 'mock random vote'; }
      else {
        const runtime = orch.runtimes.get(voter.id)!;
        const prompt = `JUDGING PHASE. The experiment is over; no more building. Vote for the best published project that is NOT yours/your team's. Eligible projects:\n${eligible.map((p) => `- project_id ${p.id}: "${p.name}" by ${p.memberIds.join(', ')} — ${p.description.slice(0, 400)}`).join('\n')}\n\nJudge from the descriptions and anything you learned during the experiment (you cannot fetch artifacts now). Answer as JSON with project_id and a one-sentence reason.`;
        try {
          const h = await runtime.start({ runId: newId('vote'), agentId: voter.id, prompt, systemPrompt: '', model: voter.model, effort: 'low', tools: [], sessionId: voter.runtimeSessionId!, isFirstRun: voter.runCount === 0, maxBudgetUsd: Math.max(0.01, s.remaining(voter.id)), maxRunSec: 300, jsonSchema: VOTE_SCHEMA }, { onUsage: (d, u) => { s.chargeLlm(voter.id, d, u); } });
          const r = await h.result;
          const so: any = r.structuredOutput ?? tryParse(r.finalText);
          choice = so?.project_id ?? null; reason = so?.reason ?? '';
        } catch (e) { details.push(`${voter.id}: vote failed (${(e as Error).message})`); }
      }
      if (choice && eligible.some((p) => p.id === choice)) { votes.set(choice, (votes.get(choice) ?? 0) + 1); details.push(`${voter.id} → ${choice}${reason ? ` (${reason.slice(0, 120)})` : ''}`); orch.bus.emitEvent('JUDGE_SCORE', voter.id, { component: 'peer_vote', projectId: choice, reason }); }
      else details.push(`${voter.id}: invalid/self vote ignored`);
    }));
    const max = Math.max(1, ...votes.values());
    return projects.map((p) => ({ projectId: p.id, score: (votes.get(p.id) ?? 0) / max, detail: `${votes.get(p.id) ?? 0} vote(s). ${details.filter((d) => d.includes(p.id)).join('; ')}` }));
  }
}

/** Human votes arrive from the UI as HUMAN_VOTE events; recomputed whenever a vote lands. */
export class HumanVoteJudge implements Judge {
  name = 'human';
  async run({ orch, projects }: JudgeContext): Promise<JudgeResult[]> {
    const votes = new Map<string, Set<string>>();
    for (const e of orch.store.listEvents({ types: ['HUMAN_VOTE'] })) {
      const pid = String(e.data.projectId); const voter = String(e.data.voter ?? 'anon');
      for (const set of votes.values()) set.delete(voter); // one vote per voter
      if (!votes.has(pid)) votes.set(pid, new Set());
      votes.get(pid)!.add(voter);
    }
    const max = Math.max(1, ...[...votes.values()].map((s) => s.size));
    return projects.map((p) => ({ projectId: p.id, score: (votes.get(p.id)?.size ?? 0) / max, detail: `${votes.get(p.id)?.size ?? 0} human vote(s)` }));
  }
}

export interface JudgingOutcome { scores: ProjectScore[]; components: Record<string, JudgeResult[]>; winner: string | null; judgedAt: number }

export async function runJudging(orch: Orchestrator, judges: Judge[] = [new ObjectiveJudge(), new LlmJudge(), new PeerVoteJudge(), new HumanVoteJudge()]): Promise<JudgingOutcome> {
  const projects = [...orch.society.projects.values()];
  orch.bus.emitEvent('JUDGING_STARTED', null, { projects: projects.map((p) => ({ id: p.id, name: p.name, members: p.memberIds })), judges: judges.map((j) => j.name) });
  let judgeSandbox: Sandbox | null = null;
  const extracted = new Map<string, string>();
  if (projects.length) {
    try {
      judgeSandbox = await orch.provider.create({ experimentId: orch.experimentId, agentId: 'JUDGE', env: orch.judgeEnv(), lifetimeSec: 3600 });
      for (const p of projects) {
        const art = orch.society.artifacts.get(p.artifactId);
        if (!art) continue;
        const dir = path.posix.join(judgeSandbox.workspace, 'projects', p.id);
        const tmp = `${dir}.tar.gz`;
        await judgeSandbox.writeFile(tmp, fs.readFileSync(art.storagePath));
        await judgeSandbox.run(`mkdir -p ${shellJoin([dir])} && tar xzf ${shellJoin([tmp])} -C ${shellJoin([dir])} --strip-components=1 2>/dev/null || tar xzf ${shellJoin([tmp])} -C ${shellJoin([dir])}; rm -f ${shellJoin([tmp])}`);
        extracted.set(p.id, dir);
      }
    } catch (e) { console.error('[judging] judge sandbox failed', e); }
  }
  const components: Record<string, JudgeResult[]> = {};
  for (const j of judges) {
    try { components[j.name] = await j.run({ orch, projects, judgeSandbox, extracted }); }
    catch (e) { console.error(`[judging] ${j.name} failed`, e); components[j.name] = projects.map((p) => ({ projectId: p.id, score: 0, detail: `judge error: ${(e as Error).message}` })); }
    for (const r of components[j.name]) orch.bus.emitEvent('JUDGE_SCORE', null, { component: j.name, projectId: r.projectId, score: round(r.score), detail: r.detail });
  }
  const outcome = aggregate(orch, projects, components);
  if (judgeSandbox) { try { await judgeSandbox.destroy(); } catch {} }
  orch.bus.emitEvent('JUDGING_COMPLETED', null, { winner: outcome.winner, scores: outcome.scores });
  return outcome;
}

export function aggregate(orch: Orchestrator, projects: Project[], components: Record<string, JudgeResult[]>): JudgingOutcome {
  const w = orch.cfg.judgeWeights as Record<string, number>;
  const scores: ProjectScore[] = projects.map((p) => {
    const comps: ProjectScore['components'] = {};
    let total = 0;
    for (const [name, results] of Object.entries(components)) {
      const r = results.find((x) => x.projectId === p.id);
      const weight = w[name] ?? 0;
      comps[name] = { score: round(r?.score ?? 0), weight, detail: r?.detail ?? '' };
      total += (r?.score ?? 0) * weight;
    }
    return { projectId: p.id, components: comps, total: round(total), rank: 0 };
  });
  scores.sort((a, b) => b.total - a.total);
  scores.forEach((s, i) => (s.rank = i + 1));
  return { scores, components, winner: scores[0]?.projectId ?? null, judgedAt: Date.now() };
}

function tryParse(t: string): unknown { try { return JSON.parse(t); } catch { const m = t.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} } return null; } }
