import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { Orchestrator } from '../society/orchestrator.js';
import type { ExperimentStore } from '../store/db.js';
import type { EventBus } from '../events.js';
import { SocietyMcpEndpoint } from './mcp.js';
import { LlmGateway } from './gateway.js';
import { redactConfig, type SocietyConfig } from '../config.js';
import { aggregate, HumanVoteJudge, type JudgingOutcome } from '../judging/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(here, '../../ui');
const D3 = path.resolve(here, '../../node_modules/d3/dist/d3.min.js');

export interface ServerDeps {
  cfg: SocietyConfig;
  store: ExperimentStore;
  bus: EventBus;
  experimentId: string;
  /** null in replay mode */
  orch: Orchestrator | null;
  onEndRequested?: () => Promise<void>;
  judging?: { outcome: JudgingOutcome | null };
}

export function startServer(deps: ServerDeps) {
  const { cfg, store, bus, orch } = deps;
  const mcp = orch ? new SocietyMcpEndpoint(orch) : null;
  const gateway = orch && cfg.mode === 'real' && cfg.agentAuthMode === 'gateway' && cfg.anthropicApiKey ? new LlmGateway(orch, cfg.anthropicUpstream, cfg.anthropicApiKey) : null;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const p = url.pathname;
      if (p === '/mcp') {
        if (!mcp) return json(res, 503, { error: 'no live experiment' });
        const body = await readBody(req);
        return mcp.handle(req, res, body.length ? JSON.parse(body.toString('utf8')) : undefined);
      }
      if (p.startsWith('/gateway/')) {
        if (!gateway) return json(res, 503, { error: 'gateway disabled' });
        return gateway.handle(req, res, p.slice('/gateway'.length), await readBody(req));
      }
      if (p === '/favicon.ico') { res.writeHead(204).end(); return; }
      if (p === '/' || p === '/index.html') return file(res, path.join(UI_DIR, 'index.html'), 'text/html; charset=utf-8');
      if (p === '/app.js') return file(res, path.join(UI_DIR, 'app.js'), 'application/javascript');
      if (p === '/style.css') return file(res, path.join(UI_DIR, 'style.css'), 'text/css');
      if (p === '/d3.min.js') return file(res, D3, 'application/javascript');
      if (p === '/api/experiment') return json(res, 200, experimentInfo(deps));
      if (p === '/api/events') return json(res, 200, store.listEvents({ afterSeq: Number(url.searchParams.get('after') ?? 0), limit: Number(url.searchParams.get('limit') ?? 0) || undefined }));
      if (p === '/api/state') return json(res, 200, orch ? orch.society.snapshot() : store.getKV('snapshot') ?? null);
      if (p === '/api/scores') return json(res, 200, deps.judging?.outcome ?? store.getKV('scores') ?? null);
      if (p === '/api/runs') return json(res, 200, store.db.prepare('SELECT id, agent_id, started_at, ended_at, cost_usd, input_tokens, output_tokens, model, exit_reason FROM runs ORDER BY started_at').all());
      if (p.startsWith('/api/artifacts/') && req.method === 'GET') {
        const id = p.split('/')[3];
        const art = orch?.society.artifacts.get(id);
        if (!art) return json(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${art.name.replace(/[^\w.-]/g, '_')}.v${art.version}.tar.gz"` });
        return fs.createReadStream(art.storagePath).pipe(res);
      }
      if (p === '/api/vote' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        if (!body.projectId) return json(res, 400, { error: 'projectId required' });
        bus.emitEvent('HUMAN_VOTE', null, { projectId: String(body.projectId), voter: String(body.voter ?? req.socket.remoteAddress ?? 'anon') });
        if (orch && deps.judging?.outcome) {
          const projects = [...orch.society.projects.values()];
          const human = await new HumanVoteJudge().run({ orch, projects, judgeSandbox: null, extracted: new Map() });
          deps.judging.outcome = aggregate(orch, projects, { ...deps.judging.outcome.components, human });
          store.setKV('scores', deps.judging.outcome); store.writeJson('scores.json', deps.judging.outcome);
          bus.emitEvent('JUDGING_COMPLETED', null, { winner: deps.judging.outcome.winner, scores: deps.judging.outcome.scores, reason: 'human vote' });
        }
        return json(res, 200, { ok: true });
      }
      if (p === '/api/oracle/pending') return json(res, 200, orch ? [...orch.oracleQueue.values()].filter((q) => !q.answer).map((q) => ({ id: q.id, agentId: q.agentId, question: q.question, askedAt: q.askedAt, waitedSec: Math.round((Date.now() - q.askedAt) / 1000) })) : []);
      if (p === '/api/oracle/answer' && req.method === 'POST') {
        if (!orch) return json(res, 400, { error: 'replay mode' });
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const ok = orch.answerOracle(String(body.id), String(body.answer ?? ''));
        return json(res, ok ? 200 : 404, { ok });
      }
      if (p === '/api/experiment/end' && req.method === 'POST') {
        if (!orch) return json(res, 400, { error: 'replay mode' });
        void deps.onEndRequested?.();
        return json(res, 200, { ok: true });
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      console.error('[http]', e);
      if (!res.headersSent) json(res, 500, { error: (e as Error).message });
      else res.end();
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'hello', experiment: experimentInfo(deps), events: store.listEvents() }));
  });
  bus.onEvent((ev) => {
    const msg = JSON.stringify({ type: 'event', event: ev });
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
  });

  return new Promise<http.Server>((resolve) => server.listen(cfg.port, cfg.host, () => resolve(server)));
}

function experimentInfo(deps: ServerDeps) {
  const exp = deps.store.getKV<any>('experiment') ?? {};
  return { id: deps.experimentId, live: !!deps.orch, mode: deps.cfg.mode, provider: deps.cfg.sandboxProvider, runtime: deps.cfg.mode === 'mock' ? 'mock' : 'claude-code', model: deps.cfg.agentModel, phase: deps.orch?.society.phase ?? 'replay', startedAt: exp.startedAt, endsAt: exp.endsAt, config: redactConfig(deps.cfg), scores: deps.judging?.outcome ?? deps.store.getKV('scores') ?? null };
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => { const chunks: Buffer[] = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject); });
}
function json(res: ServerResponse, status: number, body: unknown) { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end(JSON.stringify(body)); }
function file(res: ServerResponse, p: string, type: string) {
  if (!fs.existsSync(p)) return json(res, 404, { error: `missing ${path.basename(p)}` });
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' }).end(fs.readFileSync(p));
}
