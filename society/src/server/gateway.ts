import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Orchestrator } from '../society/orchestrator.js';
import { costOf } from '../economy/pricing.js';
import { round } from '../economy/ledger.js';

/**
 * LLM gateway: sandboxes never hold the real Anthropic key. Their runtime is
 * pointed at ANTHROPIC_BASE_URL=<orchestrator>/gateway with a per-agent scoped
 * key. The gateway authenticates, enforces budget, forwards upstream with the
 * master key, and meters usage from the response (JSON or SSE).
 */
export class LlmGateway {
  constructor(private orch: Orchestrator, private upstream: string, private apiKey: string) {}

  async handle(req: IncomingMessage, res: ServerResponse, subPath: string, body: Buffer) {
    const key = (req.headers['x-api-key'] as string | undefined) ?? (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined);
    const agentId = this.orch.authenticate(key);
    if (!agentId) return json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid agent credential' } });
    const remaining = agentId.startsWith('$') ? Infinity : this.orch.society.remaining(agentId);
    if (remaining <= 0) return json(res, 402, { type: 'error', error: { type: 'budget_exhausted', message: `agent ${agentId} has no budget left` } });
    if (req.method !== 'POST' || !/^\/v1\/messages(\/count_tokens)?$/.test(subPath)) {
      if (req.method === 'GET' && subPath.startsWith('/v1/models')) { /* allowed passthrough */ } else return json(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'gateway only proxies /v1/messages' } });
    }
    let payload: any = null;
    try { payload = body.length ? JSON.parse(body.toString('utf8')) : null; } catch { return json(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'invalid JSON' } }); }
    const model: string = payload?.model ?? 'unknown';
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': (req.headers['anthropic-version'] as string) ?? '2023-06-01' };
    if (req.headers['anthropic-beta']) headers['anthropic-beta'] = String(req.headers['anthropic-beta']);
    let upstream: Response;
    try {
      upstream = await fetch(`${this.upstream}${subPath}`, { method: req.method, headers, body: req.method === 'POST' ? new Uint8Array(body) : undefined });
    } catch (e) { return json(res, 502, { type: 'error', error: { type: 'api_error', message: `upstream unreachable: ${(e as Error).message}` } }); }
    const ct = upstream.headers.get('content-type') ?? 'application/json';
    res.writeHead(upstream.status, { 'content-type': ct });
    if (subPath.endsWith('/count_tokens') || subPath.startsWith('/v1/models')) { res.end(Buffer.from(await upstream.arrayBuffer())); return; }
    if (ct.includes('text/event-stream') && upstream.body) {
      const reader = upstream.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let msgModel = model;
      const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          res.write(value);
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line.startsWith('data:')) continue;
            try {
              const ev = JSON.parse(line.slice(5).trim());
              if (ev.type === 'message_start' && ev.message?.usage) {
                msgModel = ev.message.model ?? msgModel;
                usage.inputTokens = ev.message.usage.input_tokens ?? 0;
                usage.cacheReadTokens = ev.message.usage.cache_read_input_tokens ?? 0;
                usage.cacheWriteTokens = ev.message.usage.cache_creation_input_tokens ?? 0;
              } else if (ev.type === 'message_delta' && ev.usage) {
                usage.outputTokens = ev.usage.output_tokens ?? usage.outputTokens;
                if (ev.usage.input_tokens) usage.inputTokens = ev.usage.input_tokens;
                if (ev.usage.cache_read_input_tokens) usage.cacheReadTokens = ev.usage.cache_read_input_tokens;
                if (ev.usage.cache_creation_input_tokens) usage.cacheWriteTokens = ev.usage.cache_creation_input_tokens;
              }
            } catch {}
          }
        }
      } finally {
        res.end();
        this.meter(agentId, msgModel, usage);
      }
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
    if (upstream.ok) {
      try {
        const m = JSON.parse(buf.toString('utf8'));
        if (m.usage) this.meter(agentId, m.model ?? model, { inputTokens: m.usage.input_tokens ?? 0, outputTokens: m.usage.output_tokens ?? 0, cacheReadTokens: m.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: m.usage.cache_creation_input_tokens ?? 0 });
      } catch {}
    }
  }

  private meter(agentId: string, model: string, usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }) {
    const usd = costOf(model, usage);
    if (usd <= 0) return;
    // The runtime also reports cost at the end of a run; the ledger takes the max so gateway metering never double-charges.
    this.orch.recordGatewayUsage(agentId, usd, usage);
    if (!agentId.startsWith('$')) this.orch.bus.emitEvent('BUDGET_SPENT', agentId, { usd: round(usd), reason: 'llm (gateway)', model, remaining: round(this.orch.society.remaining(agentId)) });
  }
}

function json(res: ServerResponse, status: number, body: unknown) { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body)); }
