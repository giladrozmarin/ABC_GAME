import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExperimentStore } from './store/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(here, '../ui');
const D3 = path.resolve(here, '../node_modules/d3/dist/d3.min.js');

/**
 * Render a stored experiment into ONE self-contained HTML file: the same UI,
 * the full event log and d3 embedded, so it works offline. Open it anywhere, scrub or press
 * play to watch the organization emerge. No server needed.
 */
export function exportExperiment(dir: string, experimentId: string): string {
  const store = new ExperimentStore(dir);
  const events = store.listEvents();
  const exp = store.getKV<any>('experiment') ?? {};
  const scores = store.getKV('scores') ?? null;
  store.close();
  const cfg = exp.config ?? {};
  const experiment = { id: experimentId, live: false, mode: exp.mode ?? cfg.mode ?? 'unknown', provider: cfg.sandboxProvider, runtime: exp.runtime ?? (exp.mode === 'mock' ? 'mock' : 'claude-code'), model: exp.model ?? cfg.agentModel, phase: 'replay', startedAt: exp.startedAt, endsAt: exp.endsAt, config: cfg, scores };
  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf8');
  const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>')).replace(/<script[^>]*><\/script>/g, '');
  const css = fs.readFileSync(path.join(UI_DIR, 'style.css'), 'utf8');
  const js = fs.readFileSync(path.join(UI_DIR, 'app.js'), 'utf8');
  const started = exp.startedAt ? new Date(exp.startedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '';
  const note = `${events.length} events · ${experiment.mode} mode · ${experiment.runtime} · ${experiment.model ?? ''} · ${started}`;
  const safe = (s: string) => s.replace(/<\/script/gi, '<\\/script');
  return [
    `<title>Agent Society Replay</title>`,
    `<style>${css}\nhtml,body{height:100%}</style>`,
    body.replace('<div id="legend">', `<div id="static-note">Replay of experiment ${experimentId} — ${note}. Press ▶ play or drag the slider.</div>\n    <div id="legend">`),
    `<script>${safe(fs.readFileSync(D3, 'utf8'))}</script>`,
    `<script>window.SOCIETY_STATIC = ${safe(JSON.stringify({ experiment, events }))};</script>`,
    `<script>${safe(js)}</script>`,
  ].join('\n');
}
