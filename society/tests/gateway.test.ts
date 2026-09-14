import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { ExperimentStore } from '../src/store/db.js';
import { EventBus } from '../src/events.js';
import { Orchestrator } from '../src/society/orchestrator.js';
import { ProcessSandboxProvider } from '../src/sandbox/process.js';
import { LlmGateway } from '../src/server/gateway.js';

const servers: http.Server[] = [];
afterAll(() => servers.forEach((s) => s.close()));

function listen(handler: http.RequestListener): Promise<number> {
  return new Promise((resolve) => { const s = http.createServer(handler); servers.push(s); s.listen(0, '127.0.0.1', () => resolve((s.address() as any).port)); });
}

describe('LLM gateway', () => {
  it('authenticates scoped keys, proxies, meters SSE usage into the ledger, and refuses exhausted agents', async () => {
    // Fake Anthropic upstream: streams a message with known usage.
    let sawMasterKey = '';
    const upstreamPort = await listen((req, res) => {
      sawMasterKey = String(req.headers['x-api-key']);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { model: 'claude-haiku-4-5', usage: { input_tokens: 1000000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })}\n\n`);
      res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 100000 } })}\n\n`);
      res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'society-gw-'));
    const cfg = loadConfig({ mode: 'real', sandboxProvider: 'process', agentAuthMode: 'gateway', anthropicApiKey: 'sk-master', dataDir: dir, rootAgents: 1, rootBudgetUsd: 2, experimentDurationSec: 60, anthropicUpstream: `http://127.0.0.1:${upstreamPort}` } as any);
    const store = new ExperimentStore(path.join(dir, 'exp'));
    const orch = new Orchestrator({ cfg, store, bus: new EventBus(store), provider: new ProcessSandboxProvider(dir), experimentId: 'exp' });
    await orch.start();
    const gw = new LlmGateway(orch, cfg.anthropicUpstream, 'sk-master');
    const gwPort = await listen((req, res) => { const chunks: Buffer[] = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => void gw.handle(req, res, new URL(req.url!, 'http://x').pathname.replace('/gateway', ''), Buffer.concat(chunks))); });
    const agentKey = (orch.sandboxes.get('A') as any).baseEnv.ANTHROPIC_API_KEY as string;
    const body = JSON.stringify({ model: 'claude-haiku-4-5', stream: true, max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });

    const bad = await fetch(`http://127.0.0.1:${gwPort}/gateway/v1/messages`, { method: 'POST', headers: { 'x-api-key': 'society-forged' }, body });
    expect(bad.status).toBe(401);

    const ok = await fetch(`http://127.0.0.1:${gwPort}/gateway/v1/messages`, { method: 'POST', headers: { 'x-api-key': agentKey, 'content-type': 'application/json' }, body });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('message_stop');
    expect(sawMasterKey).toBe('sk-master');
    // 1M input @ $1 + 100k output @ $5/M = $1.50 charged to A
    expect(orch.society.remaining('A')).toBeCloseTo(0.5, 5);
    expect(orch.society.agents.get('A')!.usage.inputTokens).toBe(1000000);

    // Second call exhausts; third is refused before reaching upstream.
    await fetch(`http://127.0.0.1:${gwPort}/gateway/v1/messages`, { method: 'POST', headers: { 'x-api-key': agentKey }, body });
    expect(orch.society.remaining('A')).toBeLessThanOrEqual(0);
    sawMasterKey = '';
    const refused = await fetch(`http://127.0.0.1:${gwPort}/gateway/v1/messages`, { method: 'POST', headers: { 'x-api-key': agentKey }, body });
    expect(refused.status).toBe(402);
    expect(sawMasterKey).toBe('');
    expect(orch.society.ledger.audit().ok).toBe(true);
    await orch.shutdown();
  });
});
