import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { SocietyEvent, EventType } from '../types.js';

/**
 * Append-only experiment store. Everything needed to reconstruct an experiment
 * lives here: config, prompts, events, final projects, scores.
 */
export class ExperimentStore {
  readonly db: DatabaseSync;
  readonly dir: string;
  private insertEvent;
  private seq = 0;

  constructor(dir: string) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, 'experiment.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        agent_id TEXT,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_type ON events(type);
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, started_at INTEGER, ended_at INTEGER,
        prompt TEXT, cost_usd REAL, input_tokens INTEGER, output_tokens INTEGER,
        cache_read_tokens INTEGER, cache_write_tokens INTEGER, model TEXT, exit_reason TEXT, transcript_path TEXT
      );
    `);
    this.insertEvent = this.db.prepare('INSERT INTO events (seq, id, ts, type, agent_id, data) VALUES (?, ?, ?, ?, ?, ?)');
    const row = this.db.prepare('SELECT MAX(seq) AS m FROM events').get() as { m: number | null };
    this.seq = row?.m ?? 0;
  }

  appendEvent(e: Omit<SocietyEvent, 'seq'>): SocietyEvent {
    const seq = ++this.seq;
    this.insertEvent.run(seq, e.id, e.ts, e.type, e.agentId, JSON.stringify(e.data));
    return { ...e, seq };
  }

  listEvents(opts: { types?: EventType[]; afterSeq?: number; limit?: number } = {}): SocietyEvent[] {
    let sql = 'SELECT seq, id, ts, type, agent_id, data FROM events WHERE seq > ?';
    const params: (number | string)[] = [opts.afterSeq ?? 0];
    if (opts.types?.length) {
      sql += ` AND type IN (${opts.types.map(() => '?').join(',')})`;
      params.push(...opts.types);
    }
    sql += ' ORDER BY seq ASC';
    if (opts.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    return (this.db.prepare(sql).all(...params) as { seq: number; id: string; ts: number; type: string; agent_id: string | null; data: string }[])
      .map((r) => ({ seq: r.seq, id: r.id, ts: r.ts, type: r.type as EventType, agentId: r.agent_id, data: JSON.parse(r.data) }));
  }

  setKV(key: string, value: unknown) {
    this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }
  getKV<T = unknown>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  recordRun(run: {
    id: string; agentId: string; startedAt: number; endedAt: number | null; prompt: string; costUsd: number;
    inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; model: string; exitReason: string; transcriptPath: string | null;
  }) {
    this.db.prepare(`INSERT INTO runs (id, agent_id, started_at, ended_at, prompt, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, model, exit_reason, transcript_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET ended_at=excluded.ended_at, cost_usd=excluded.cost_usd, input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens,
        cache_read_tokens=excluded.cache_read_tokens, cache_write_tokens=excluded.cache_write_tokens, exit_reason=excluded.exit_reason, transcript_path=excluded.transcript_path`)
      .run(run.id, run.agentId, run.startedAt, run.endedAt, run.prompt, run.costUsd, run.inputTokens, run.outputTokens, run.cacheReadTokens, run.cacheWriteTokens, run.model, run.exitReason, run.transcriptPath);
  }

  /** Write a human-readable JSON sidecar (useful for inspection without sqlite tooling). */
  writeJson(name: string, value: unknown) {
    fs.writeFileSync(path.join(this.dir, name), JSON.stringify(value, null, 2));
  }

  close() { this.db.close(); }
}
