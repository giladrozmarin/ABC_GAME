import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Orchestrator } from '../society/orchestrator.js';
import { buildCapabilities, callCapability, type Capability } from '../society/capabilities.js';

/**
 * MCP (Streamable HTTP) endpoint. Each request carries the agent's bearer
 * token; the server built for that request only exposes tools acting as that
 * agent. Stateless transport: every request is independent.
 */
export class SocietyMcpEndpoint {
  private caps: Capability[];
  constructor(private orch: Orchestrator) { this.caps = buildCapabilities(orch); }

  async handle(req: IncomingMessage, res: ServerResponse, body: unknown) {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
    const agentId = this.orch.authenticate(token);
    if (!agentId) { res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid or revoked agent token' })); return; }
    const server = new McpServer({ name: 'society', version: '0.1.0' });
    for (const cap of this.caps) {
      server.registerTool(cap.name, { description: cap.description, inputSchema: cap.schema.shape }, async (args: any) => {
        const r = await callCapability(this.orch, this.caps, agentId, cap.name, args);
        if (r.ok) return { content: [{ type: 'text' as const, text: JSON.stringify(r.result, null, 2) }] };
        return { content: [{ type: 'text' as const, text: `ERROR: ${r.error}` }], isError: true };
      });
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }
}
