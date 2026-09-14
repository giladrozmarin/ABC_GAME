import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, type SocietyConfig } from '../src/config.js';
import { ExperimentStore } from '../src/store/db.js';
import { EventBus } from '../src/events.js';
import { Society } from '../src/society/society.js';

export function makeSociety(overrides: Partial<SocietyConfig> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'society-test-'));
  const cfg = loadConfig({ mode: 'mock', sandboxProvider: 'process', agentAuthMode: 'inherit', dataDir: dir, rootAgents: 4, rootBudgetUsd: 20, maxTotalBudgetUsd: 100, maxTotalAgents: 12, maxChildrenPerAgent: 3, maxDepth: 4, minChildBudgetUsd: 0.5, messageFeeUsd: 0.01, broadcastFeeUsd: 0.05, ...overrides });
  const store = new ExperimentStore(dir);
  const bus = new EventBus(store);
  const society = new Society(cfg, bus);
  society.phase = 'running';
  society.startedAt = Date.now();
  society.endsAt = Date.now() + 3600_000;
  return { cfg, store, bus, society, dir };
}
