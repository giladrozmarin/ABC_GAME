import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, redactConfig } from '../src/config.js';
import { ExperimentStore } from '../src/store/db.js';
import { EventBus } from '../src/events.js';
import { Orchestrator } from '../src/society/orchestrator.js';
import { ProcessSandboxProvider } from '../src/sandbox/process.js';
import { safeRelPath, shellQuote } from '../src/util.js';

function makeOrch(over: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'society-sec-'));
  const cfg = loadConfig({ mode: 'mock', sandboxProvider: 'process', agentAuthMode: 'inherit', dataDir: dir, rootAgents: 2, rootBudgetUsd: 5, experimentDurationSec: 60, ...over } as any);
  const store = new ExperimentStore(path.join(dir, 'exp'));
  const bus = new EventBus(store);
  const orch = new Orchestrator({ cfg, store, bus, provider: new ProcessSandboxProvider(dir), experimentId: 'exp' });
  return { orch, cfg, store };
}

describe('credential scoping', () => {
  it('agent tokens authenticate only their own live agent and are revoked on termination', async () => {
    const { orch } = makeOrch();
    await orch.start();
    const s = orch.society;
    const [a, b] = [...s.agents.values()];
    const tokA = [...(orch as any).tokens.entries()].find(([, id]) => id === a.id)![0] as string;
    expect(orch.authenticate(tokA)).toBe(a.id);
    expect(orch.authenticate(`society-${tokA}`)).toBe(a.id);
    expect(orch.authenticate('nope')).toBeNull();
    expect(orch.authenticate(undefined)).toBeNull();
    const c = await orch.spawn(a.id, { purpose: 'child', instructions: 'work hard please', budgetUsd: 1 });
    await new Promise((r) => setTimeout(r, 50));
    const tokC = [...(orch as any).tokens.entries()].find(([, id]) => id === c.id)![0] as string;
    expect(orch.authenticate(tokC)).toBe(c.id);
    await orch.terminateAgent(c.id, a.id, 'bye');
    expect(orch.authenticate(tokC)).toBeNull();
    expect(orch.authenticate(tokA)).toBe(a.id);
    expect(s.remaining(b.id)).toBe(5);
    await orch.shutdown();
  });

  it('sandbox env never contains provider credentials or the master API key', async () => {
    const { orch } = makeOrch();
    process.env.DAYTONA_API_KEY = 'daytona-secret';
    await orch.start();
    const sb = orch.sandboxes.get('A') as any;
    const env = sb.baseEnv as Record<string, string>;
    expect(Object.values(env).join(' ')).not.toContain('daytona-secret');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined(); // inherit mode: no key handed out at all
    expect(env.DAYTONA_API_KEY).toBeUndefined();
    delete process.env.DAYTONA_API_KEY;
    await orch.shutdown();
  });

  it('gateway mode hands each sandbox a scoped, distinct key that routes through the orchestrator', async () => {
    const { orch, cfg } = makeOrch({ mode: 'real', agentAuthMode: 'gateway', anthropicApiKey: 'sk-master-secret', publicUrl: 'http://orch:4000' });
    (orch as any).cfg = cfg;
    await orch.start();
    const envs = [...orch.sandboxes.values()].map((sb: any) => sb.baseEnv as Record<string, string>);
    for (const env of envs) {
      expect(env.ANTHROPIC_BASE_URL).toBe('http://orch:4000/gateway');
      expect(env.ANTHROPIC_API_KEY).toMatch(/^society-/);
      expect(env.ANTHROPIC_API_KEY).not.toContain('sk-master-secret');
    }
    expect(new Set(envs.map((e) => e.ANTHROPIC_API_KEY)).size).toBe(envs.length);
    expect(redactConfig(cfg).anthropicApiKey).toBe('<set>');
    await orch.shutdown();
  });

  it('config validation rejects unsafe combinations', () => {
    expect(() => loadConfig({ mode: 'real', agentAuthMode: 'gateway', anthropicApiKey: undefined } as any)).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => loadConfig({ mode: 'real', agentAuthMode: 'inherit', sandboxProvider: 'daytona' } as any)).toThrow(/gateway/);
    expect(() => loadConfig({ rootAgents: 10, rootBudgetUsd: 20, maxTotalBudgetUsd: 100 } as any)).toThrow(/exceeds MAX_TOTAL_BUDGET/);
  });
});

describe('workspace path safety', () => {
  it('rejects escaping paths', () => {
    expect(safeRelPath('src')).toBe('src');
    expect(safeRelPath('./src/')).toBe('src');
    expect(safeRelPath('.')).toBe('.');
    expect(() => safeRelPath('../etc')).toThrow();
    expect(() => safeRelPath('/etc/passwd')).toThrow();
    expect(() => safeRelPath('a/../../b')).toThrow();
  });
  it('shell quoting neutralises injection', () => {
    expect(shellQuote(`x'; rm -rf / #`)).toBe(`'x'\\''; rm -rf / #'`);
    expect(shellQuote('safe-name_1.txt')).toBe('safe-name_1.txt');
  });
});
