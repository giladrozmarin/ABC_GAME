import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { ExperimentStore } from './store/db.js';
import { EventBus } from './events.js';
import { createSandboxProvider } from './sandbox/index.js';
import { Orchestrator } from './society/orchestrator.js';
import { startServer } from './server/http.js';
import { runJudging, type JudgingOutcome } from './judging/index.js';

const cmd = process.argv[2] ?? 'run';

async function main() {
  if (cmd === 'list') return list();
  if (cmd === 'replay') return replay(process.argv[3]);
  if (cmd === 'run') return run();
  console.error('usage: cli.ts run | replay <experimentId> | list');
  process.exit(1);
}

function list() {
  const cfg = loadConfig();
  if (!fs.existsSync(cfg.dataDir)) return console.log('(no experiments)');
  for (const d of fs.readdirSync(cfg.dataDir).sort()) {
    const f = path.join(cfg.dataDir, d, 'experiment.db');
    if (!fs.existsSync(f)) continue;
    const st = new ExperimentStore(path.join(cfg.dataDir, d));
    const exp = st.getKV<any>('experiment');
    const n = st.listEvents().length;
    console.log(`${d}  mode=${exp?.mode ?? '?'}  started=${exp?.startedAt ? new Date(exp.startedAt).toISOString() : '?'}  events=${n}  scores=${st.getKV('scores') ? 'yes' : 'no'}`);
    st.close();
  }
}

async function replay(id: string | undefined) {
  const cfg = loadConfig({ mode: 'mock' });
  if (!id) { console.error('replay requires an experiment id (see `npm run list`)'); process.exit(1); }
  const dir = path.join(cfg.dataDir, id);
  if (!fs.existsSync(path.join(dir, 'experiment.db'))) { console.error(`no experiment at ${dir}`); process.exit(1); }
  const store = new ExperimentStore(dir);
  const bus = new EventBus(store);
  const exp = store.getKV<any>('experiment');
  await startServer({ cfg: { ...cfg, ...(exp?.config ?? {}), port: cfg.port, host: cfg.host, mode: exp?.mode ?? cfg.mode }, store, bus, experimentId: id, orch: null });
  console.log(`Replaying experiment ${id} at http://localhost:${cfg.port}  (${store.listEvents().length} events)`);
}

async function run() {
  const cfg = loadConfig();
  const experimentId = `exp_${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}_${Math.random().toString(36).slice(2, 6)}`;
  const store = new ExperimentStore(path.join(cfg.dataDir, experimentId));
  const bus = new EventBus(store);
  const provider = createSandboxProvider(cfg);
  const orch = new Orchestrator({ cfg, store, bus, provider, experimentId });
  const judging: { outcome: JudgingOutcome | null } = { outcome: null };

  bus.onEvent((e) => {
    const skip = new Set(['AGENT_ACTIVITY', 'BUDGET_SPENT']);
    if (skip.has(e.type)) return;
    const d = e.data as any;
    const detail = e.type === 'MESSAGE_SENT' ? `${d.from}→${d.to}: ${d.preview}` : e.type === 'AGENT_RUN_ENDED' ? `${d.exitReason} $${d.costUsd} turns=${d.turns} ${d.summary ?? ''}` : e.type === 'CAPABILITY_DENIED' ? `${d.capability}: ${d.error}` : JSON.stringify(d).slice(0, 160);
    console.log(`${new Date(e.ts).toISOString().slice(11, 19)} ${e.type.padEnd(20)} ${(e.agentId ?? '-').padEnd(6)} ${detail}`);
  });

  orch.onEnded = async () => {
    judging.outcome = await runJudging(orch);
    await orch.finish(judging.outcome);
    console.log('\n=== RESULTS ===');
    for (const s of judging.outcome.scores) {
      const p = orch.society.projects.get(s.projectId)!;
      console.log(`#${s.rank} ${p.name} (${p.memberIds.join(', ')}) total=${s.total.toFixed(3)} ${Object.entries(s.components).map(([k, v]) => `${k}=${v.score.toFixed(2)}`).join(' ')}`);
    }
    if (!judging.outcome.scores.length) console.log('(no projects were published)');
    console.log(`Ledger audit: ${JSON.stringify(orch.society.ledger.audit())}`);
    if (process.env.KEEP_ALIVE !== '1') { await orch.shutdown(); console.log('Sandboxes stopped. UI remains available for replay; Ctrl-C to exit.'); }
  };

  await startServer({ cfg, store, bus, experimentId, orch, judging, onEndRequested: () => orch.endExperiment('ended by operator') });
  console.log(`\nAgent society experiment ${experimentId}`);
  console.log(`mode=${cfg.mode} provider=${cfg.sandboxProvider} auth=${cfg.agentAuthMode} model=${cfg.agentModel} roots=${cfg.rootAgents}×$${cfg.rootBudgetUsd} duration=${cfg.experimentDurationSec}s`);
  console.log(`UI: http://localhost:${cfg.port}   (orchestrator public URL for sandboxes: ${cfg.publicUrl})\n`);
  await orch.start();

  const stop = async () => { console.log('\nshutting down…'); await orch.shutdown(); store.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

main().catch((e) => { console.error(e); process.exit(1); });
