import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadConfig } from '../src/config.js';
import { ExperimentStore } from '../src/store/db.js';
import { EventBus } from '../src/events.js';
import { Orchestrator } from '../src/society/orchestrator.js';
import { ProcessSandboxProvider } from '../src/sandbox/process.js';
import { startServer } from '../src/server/http.js';

describe('MCP capability endpoint', () => {
  it('serves tools per authenticated agent; spawn/message/share round-trip through real sandboxes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'society-mcp-'));
        const cfg = loadConfig({ mode: 'mock', sandboxProvider: 'process', agentAuthMode: 'inherit', dataDir: dir, rootAgents: 2, rootBudgetUsd: 5, experimentDurationSec: 120, port: 0, host: '127.0.0.1' } as any);
    const store = new ExperimentStore(path.join(dir, 'exp'));
    const bus = new EventBus(store);
    const orch = new Orchestrator({ cfg, store, bus, provider: new ProcessSandboxProvider(dir), experimentId: 'exp' });
    const server = await startServer({ cfg, store, bus, experimentId: 'exp', orch });
    const port = (server.address() as any).port as number;
    await orch.start();
    // Freeze the scheduler so the mock runtime doesn't interfere.
    for (const a of orch.society.agents.values()) a.wakeAt = Date.now() + 1e9;
    const tokenOf = (id: string) => [...(orch as any).tokens.entries()].find(([, v]) => v === id)![0] as string;

    const connect = async (token: string) => {
      const client = new Client({ name: 'test', version: '0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      return client;
    };
    await expect(connect('forged')).rejects.toThrow();

    const A = await connect(tokenOf('A'));
    const tools = await A.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('spawn_agent');
    const call = async (c: Client, name: string, args: any) => { const r: any = await c.callTool({ name, arguments: args }); return { isError: !!r.isError, text: r.content[0].text as string }; };

    // Write a file in A's sandbox, share it, and have B fetch it.
    fs.writeFileSync(path.join(orch.sandboxes.get('A')!.workspace, 'lib.js'), 'module.exports = 42;');
    const shared = await call(A, 'share_artifact', { path: 'lib.js', name: 'lib', description: 'a lib', visibility: 'private', with: ['B'] });
    expect(shared.isError).toBe(false);
    const artId = JSON.parse(shared.text).artifact_id;
    const B = await connect(tokenOf('B'));
    const fetched = await call(B, 'fetch_artifact', { artifact_id: artId });
    expect(fetched.isError).toBe(false);
    expect(fs.readFileSync(path.join(orch.sandboxes.get('B')!.workspace, 'shared', artId, 'lib.js'), 'utf8')).toBe('module.exports = 42;');
    expect(fs.existsSync(path.join(orch.sandboxes.get('B')!.workspace, 'shared', `${artId}.PROVENANCE.json`))).toBe(true);

    // Spawn a child with a context artifact and messaging; attenuation is enforced over the wire.
    const denied = await call(A, 'spawn_agent', { purpose: 'evil', instructions: 'escalate privileges now', budget_usd: 1, permissions: ['filesystem', 'aws-admin'] });
    expect(denied.isError).toBe(true);
    expect(denied.text).toMatch(/aws-admin/);
    const spawned = await call(A, 'spawn_agent', { purpose: 'helper', instructions: 'help with the thing', budget_usd: 1, permissions: ['filesystem', 'messaging'], context_artifact_ids: [artId] });
    expect(spawned.isError).toBe(false);
    const childId = JSON.parse(spawned.text).child_id;
    expect(orch.society.remaining('A')).toBeCloseTo(4 - 0); // 5 - 1 child
    for (let i = 0; i < 50 && !orch.sandboxes.get(childId); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 200));
    expect(fs.existsSync(path.join(orch.sandboxes.get(childId)!.workspace, 'shared', artId, 'lib.js'))).toBe(true);
    const msg = await call(A, 'send_message', { to: childId, content: 'hello child' });
    expect(msg.isError).toBe(false);
    const state = JSON.parse((await call(A, 'get_society_state', {})).text);
    expect(state.you.children.map((c: any) => c.id)).toContain(childId);
    // A cannot act as B: the token decides identity, not the payload.
    const inboxB = JSON.parse((await call(B, 'check_inbox', {})).text);
    expect(inboxB.messages.some((m: any) => m.artifact_ids?.includes(artId))).toBe(true);
    await orch.shutdown();
    server.close();
  }, 30000);
});
