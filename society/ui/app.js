/* Agent Society UI — a pure function of the event log.
   The same reducer drives live mode (events streamed over WebSocket) and replay (scrubbing the stored log). */
(() => {
  const $ = (s) => document.querySelector(s);
  let experiment = null;
  let allEvents = [];
  let live = true;
  let cursor = 0; // number of events applied when scrubbing
  let selected = null;
  let filters = { activity: false, spend: false };

  // ───────────── reducer ─────────────
  function reduce(events) {
    const st = { agents: new Map(), teams: new Map(), projects: new Map(), artifacts: new Map(), messages: 0, phase: 'setup', endsAt: 0, startedAt: 0, scores: null, mode: null, flashes: [] };
    for (const e of events) {
      const d = e.data || {};
      const a = e.agentId ? st.agents.get(e.agentId) : null;
      switch (e.type) {
        case 'EXPERIMENT_STARTED': st.startedAt = e.ts; st.endsAt = d.endsAt; st.mode = d.mode; st.phase = 'running'; break;
        case 'EXPERIMENT_PHASE': st.phase = d.phase; break;
        case 'AGENT_CREATED': st.agents.set(d.id, { id: d.id, parentId: d.parentId, depth: d.depth, purpose: d.purpose, model: d.model, permissions: d.permissions, status: 'provisioning', teamId: d.teamId, headline: '', task: '', allocated: d.budgetAllocated, remaining: d.budgetAllocated, spent: 0, fees: 0, in: 0, out: 0, toChildren: 0, runs: 0, children: [], createdAt: e.ts, sandbox: 'starting', lastRun: null, tokens: 0 }); if (d.parentId && st.agents.get(d.parentId)) { const p = st.agents.get(d.parentId); p.children.push(d.id); p.toChildren += d.budgetAllocated; p.remaining -= d.budgetAllocated; } if (d.teamId && st.teams.get(d.teamId) && !st.teams.get(d.teamId).members.includes(d.id)) st.teams.get(d.teamId).members.push(d.id); break;
        case 'AGENT_STATUS': if (a) a.status = d.status; break;
        case 'AGENT_ACTIVITY': if (a) a.task = d.detail; break;
        case 'AGENT_HEADLINE': if (a) a.headline = d.headline; break;
        case 'AGENT_RUN_STARTED': if (a) { a.status = 'running'; a.runs++; } break;
        case 'AGENT_RUN_ENDED': if (a) { a.lastRun = d; a.spent += d.costUsd || 0; a.remaining = d.budgetRemaining ?? a.remaining; a.task = d.summary ? d.summary.split('\n')[0] : a.task; } break;
        case 'BUDGET_SPENT': if (a) { a.fees += d.reason && d.reason.startsWith('llm') ? 0 : d.usd || 0; if (d.remaining !== undefined) a.remaining = d.remaining; } break;
        case 'BUDGET_TRANSFERRED': { const f = st.agents.get(d.from), t = st.agents.get(d.to); if (f) { f.out += d.amountUsd; f.remaining = d.fromRemaining; } if (t) { t.in += d.amountUsd; t.remaining = d.toRemaining; } st.flashes.push({ kind: 'transfer', from: d.from, to: d.to, ts: e.ts, seq: e.seq }); break; }
        case 'AGENT_TERMINATED': if (a) { a.status = 'terminated'; a.terminatedAt = e.ts; a.teamId = null; if (d.refundedTo && st.agents.get(d.refundedTo)) st.agents.get(d.refundedTo).remaining += d.refundedUsd || 0; a.remaining = 0; } break;
        case 'AGENT_BUDGET_EXHAUSTED': if (a && a.status !== 'terminated') a.status = 'exhausted'; break;
        case 'SANDBOX_STARTED': if (a) a.sandbox = 'running'; break;
        case 'SANDBOX_STOPPED': if (a) a.sandbox = 'stopped'; break;
        case 'MESSAGE_SENT': st.messages++; for (const r of d.recipients || []) st.flashes.push({ kind: 'msg', from: d.from, to: r, ts: e.ts, type: d.type, seq: e.seq }); break;
        case 'TEAM_FORMED': st.teams.set(d.teamId, { id: d.teamId, name: d.name, members: [...d.members], createdAt: e.ts }); for (const m of d.members) if (st.agents.get(m)) st.agents.get(m).teamId = d.teamId; break;
        case 'ALLIANCE_ACCEPTED': { let t = st.teams.get(d.teamId); if (!t) { t = { id: d.teamId, name: d.teamName, members: [], createdAt: e.ts }; st.teams.set(d.teamId, t); } t.members = [...d.members]; for (const m of d.members) if (st.agents.get(m)) st.agents.get(m).teamId = d.teamId; for (const [id, tt] of st.teams) if (id !== d.teamId) tt.members = tt.members.filter((m) => !d.members.includes(m)); break; }
        case 'ALLIANCE_LEFT': { const t = st.teams.get(d.teamId); if (t) t.members = t.members.filter((m) => m !== e.agentId); if (a) a.teamId = null; break; }
        case 'TEAM_DISSOLVED': { const t = st.teams.get(d.teamId); if (t) for (const m of t.members) if (st.agents.get(m) && st.agents.get(m).teamId === d.teamId) st.agents.get(m).teamId = null; st.teams.delete(d.teamId); break; }
        case 'ARTIFACT_SHARED': st.artifacts.set(d.artifactId, { ...d, creator: e.agentId, ts: e.ts }); break;
        case 'ARTIFACT_FETCHED': st.flashes.push({ kind: 'artifact', from: d.from, to: e.agentId, ts: e.ts, seq: e.seq }); break;
        case 'PROJECT_PUBLISHED': case 'PROJECT_UPDATED': st.projects.set(d.id, { ...d, ts: e.ts }); break;
        case 'JUDGING_COMPLETED': st.scores = d.scores; st.winner = d.winner; break;
        case 'EXPERIMENT_ENDED': st.phase = 'ended'; break;
      }
    }
    // Children born into a team
    for (const a of st.agents.values()) if (!a.teamId && a.parentId) { /* team membership only via events */ }
    return st;
  }

  // ───────────── helpers ─────────────
  const fmtT = (ts) => new Date(ts).toTimeString().slice(0, 8);
  const usd = (n) => '$' + (Number(n) || 0).toFixed(2);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function describe(e) {
    const d = e.data || {}; const who = e.agentId ? `<span class="who">${esc(e.agentId)}</span> ` : '';
    switch (e.type) {
      case 'EXPERIMENT_STARTED': return `Experiment started: ${d.rootAgents} root agents × ${usd(d.rootBudgetUsd)} · ${esc(d.model)} · ${esc(d.mode)} mode`;
      case 'EXPERIMENT_PHASE': return `Phase → <b>${esc(d.phase)}</b>${d.reason ? ` (${esc(d.reason)})` : ''}`;
      case 'AGENT_CREATED': return d.parentId ? `${who}spawned by <b>${esc(d.byAgent)}</b>: “${esc(d.purpose)}” with ${usd(d.budgetAllocated)}` : `${who}created (root) with ${usd(d.budgetAllocated)}`;
      case 'AGENT_STATUS': return `${who}is now ${esc(d.status)}${d.detail ? ` — ${esc(d.detail)}` : ''}`;
      case 'AGENT_ACTIVITY': return `${who}${esc(d.detail)}`;
      case 'AGENT_HEADLINE': return `${who}headline: “${esc(d.headline)}”`;
      case 'AGENT_RUN_STARTED': return `${who}starts thinking (${d.messages} new msgs, ${usd(d.budgetRemaining)} left)`;
      case 'AGENT_RUN_ENDED': return `${who}run ${esc(d.exitReason)} · ${usd(d.costUsd)} · ${d.turns} turns · ${d.toolCalls} tools${d.summary ? ` — ${esc(d.summary.slice(0, 160))}` : ''}${d.error ? ` — <i>${esc(d.error)}</i>` : ''}`;
      case 'AGENT_TERMINATED': return `${who}terminated by ${esc(d.byAgent)}: ${esc(d.reason)}${d.refundedUsd ? ` (refund ${usd(d.refundedUsd)} → ${esc(d.refundedTo)})` : ''}`;
      case 'AGENT_BUDGET_EXHAUSTED': return `${who}ran out of budget`;
      case 'SANDBOX_STARTED': return `${who}sandbox ready (${esc(d.provider)})`;
      case 'SANDBOX_STOPPED': return `${who}sandbox stopped`;
      case 'MESSAGE_SENT': return `${who}${d.type === 'broadcast' ? 'broadcast' : d.type === 'team' ? 'to team' : `→ <b>${esc(d.to)}</b>`}${d.type === 'review_request' ? ' (review request)' : ''}: “${esc(d.preview)}”${(d.artifactIds || []).length ? ` [+${d.artifactIds.length} artifact]` : ''}`;
      case 'ARTIFACT_SHARED': return `${who}shared “${esc(d.name)}” v${d.version} (${esc(d.visibility)}${(d.sharedWith || []).length ? ` with ${d.sharedWith.join(', ')}` : ''}, ${(d.bytes / 1024).toFixed(0)} KB)`;
      case 'ARTIFACT_FETCHED': return `${who}fetched “${esc(d.name)}” from <b>${esc(d.from)}</b>`;
      case 'BUDGET_TRANSFERRED': return `<span class="who">${esc(d.from)}</span> transferred <b>${usd(d.amountUsd)}</b> to <span class="who">${esc(d.to)}</span>${d.note ? `: ${esc(d.note)}` : ''}`;
      case 'BUDGET_SPENT': return `${who}spent ${usd(d.usd)} (${esc(d.reason)})`;
      case 'ALLIANCE_PROPOSED': return `${who}proposed an alliance to <b>${esc(d.to)}</b>: “${esc(d.proposal.slice(0, 160))}”`;
      case 'ALLIANCE_ACCEPTED': return `${who}accepted alliance with <b>${esc(d.from)}</b> → ${esc(d.teamName)} [${d.members.join(', ')}]`;
      case 'ALLIANCE_REJECTED': return `${who}rejected alliance from <b>${esc(d.from)}</b>${d.message ? `: ${esc(d.message)}` : ''}`;
      case 'ALLIANCE_LEFT': return `${who}left ${esc(d.teamName)}`;
      case 'TEAM_FORMED': return `<b>${esc(d.name)}</b> formed: ${d.members.join(' + ')}`;
      case 'TEAM_DISSOLVED': return `Team dissolved (${esc(d.reason)})`;
      case 'PROJECT_PUBLISHED': return `${who}published project <b>“${esc(d.name)}”</b>`;
      case 'PROJECT_UPDATED': return `${who}updated project <b>“${esc(d.name)}”</b> (v${d.version})`;
      case 'CAPABILITY_DENIED': return `${who}<i>${esc(d.capability)} denied: ${esc(d.error)}</i>`;
      case 'JUDGING_STARTED': return `Judging started for ${(d.projects || []).length} project(s): ${(d.judges || []).join(', ')}`;
      case 'JUDGE_SCORE': return d.component === 'peer_vote' ? `${who}voted for ${esc(d.projectId)}${d.reason ? ` — ${esc(d.reason)}` : ''}` : `${esc(d.component)} judge: ${esc(d.projectId)} = ${(d.score * 100).toFixed(0)}% — ${esc(d.detail)}`;
      case 'HUMAN_VOTE': return `Human vote for ${esc(d.projectId)}`;
      case 'JUDGING_COMPLETED': return `<b>Judging complete.</b> Winner: ${esc(d.winner || 'none')}`;
      case 'EXPERIMENT_ENDED': return `<b>Experiment ended.</b>`;
      default: return `${who}${esc(e.type)} ${esc(JSON.stringify(d).slice(0, 120))}`;
    }
  }

  // ───────────── graph ─────────────
  const svg = d3.select('#graph');
  const gHulls = svg.append('g'), gLinks = svg.append('g'), gFlash = svg.append('g'), gNodes = svg.append('g');
  const sim = d3.forceSimulation().force('charge', d3.forceManyBody().strength(-420)).force('collide', d3.forceCollide(34))
    .force('x', d3.forceX().strength(0.05)).force('y', d3.forceY().strength(0.06)).alphaDecay(0.03);
  let nodes = [], links = [];
  const color = { idle: '#38bdf8', running: '#fbbf24', provisioning: '#a78bfa', exhausted: '#f87171', terminated: '#4b5563', failed: '#7f1d1d' };
  let lastFlash = 0;

  function layoutForces(st) {
    const w = svg.node().clientWidth, h = svg.node().clientHeight;
    const roots = [...st.agents.values()].filter((a) => !a.parentId);
    const rootX = new Map(roots.map((r, i) => [r.id, (w / (roots.length + 1)) * (i + 1)]));
    sim.force('x', d3.forceX((d) => rootX.get(d.rootId) ?? w / 2).strength(0.08));
    sim.force('y', d3.forceY((d) => h * 0.22 + d.depth * 90).strength(0.12));
    sim.force('link', d3.forceLink(links).id((d) => d.id).distance((l) => (l.kind === 'team' ? 150 : 80)).strength((l) => (l.kind === 'team' ? 0.25 : 0.9)));
    sim.force('center', null);
  }

  function renderGraph(st) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    nodes = [...st.agents.values()].map((a) => Object.assign(byId.get(a.id) || { id: a.id, x: svg.node().clientWidth / 2 + (Math.random() - 0.5) * 100, y: 80 + a.depth * 90 }, { data: a, depth: a.depth, rootId: rootOf(st, a.id) }));
    links = [];
    for (const a of st.agents.values()) if (a.parentId && st.agents.has(a.parentId)) links.push({ source: a.parentId, target: a.id, kind: 'parent' });
    for (const t of st.teams.values()) { const m = t.members.filter((x) => st.agents.has(x)); for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) links.push({ source: m[i], target: m[j], kind: 'team' }); }
    sim.nodes(nodes); layoutForces(st); sim.alpha(0.6).restart();

    const link = gLinks.selectAll('line').data(links, (d) => `${d.kind}:${d.source.id || d.source}:${d.target.id || d.target}`);
    link.exit().remove();
    link.enter().append('line').attr('class', 'link').merge(link).attr('stroke', (d) => (d.kind === 'team' ? '#34d399' : '#64748b')).attr('stroke-dasharray', (d) => (d.kind === 'team' ? '5 4' : null)).attr('stroke-opacity', (d) => (d.kind === 'team' ? 0.55 : 0.8));

    const node = gNodes.selectAll('g.node').data(nodes, (d) => d.id);
    node.exit().remove();
    const enter = node.enter().append('g').attr('class', 'node').style('cursor', 'pointer').on('click', (_, d) => { selected = d.id; showTab('agent'); renderAll(); })
      .call(d3.drag().on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }).on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; }).on('end', (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
    enter.append('circle').attr('class', 'ring').attr('r', 24);
    enter.append('circle').attr('class', 'core').attr('r', 18);
    enter.append('text').attr('class', 'label').attr('text-anchor', 'middle').attr('dy', 4).attr('font-size', 12);
    enter.append('text').attr('class', 'sub').attr('text-anchor', 'middle').attr('dy', 36);
    enter.append('text').attr('class', 'sub budget').attr('text-anchor', 'middle').attr('dy', -30);
    const all = enter.merge(node);
    all.classed('selected', (d) => d.id === selected);
    all.select('circle.core').attr('fill', (d) => color[d.data.status] || '#6b7280').attr('stroke', (d) => (d.data.teamId ? '#34d399' : '#0b0f17')).attr('stroke-width', (d) => (d.data.teamId ? 2 : 1)).attr('opacity', (d) => (d.data.status === 'terminated' ? 0.45 : 1))
      .attr('r', (d) => 14 + Math.min(10, Math.sqrt(Math.max(0, d.data.remaining)) * 2));
    all.select('circle.ring').attr('stroke', (d) => (d.data.status === 'running' ? '#fbbf24' : 'none')).attr('r', (d) => 20 + Math.min(10, Math.sqrt(Math.max(0, d.data.remaining)) * 2))
      .attr('stroke-opacity', (d) => (d.data.status === 'running' ? 0.8 : 0));
    all.select('text.label').text((d) => d.id).attr('fill', (d) => (d.data.status === 'terminated' ? '#9ca3af' : '#0b0f17'));
    all.select('text.sub').text((d) => (d.data.headline || d.data.purpose || '').slice(0, 34)).attr('dy', (d) => 22 + Math.min(10, Math.sqrt(Math.max(0, d.data.remaining)) * 2) + 12);
    all.select('text.budget').text((d) => (d.data.status === 'terminated' ? '' : usd(d.data.remaining))).attr('dy', (d) => -(20 + Math.min(10, Math.sqrt(Math.max(0, d.data.remaining)) * 2)) - 4);

    sim.on('tick', () => {
      gLinks.selectAll('line').attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
      all.attr('transform', (d) => `translate(${d.x},${d.y})`);
      drawHulls(st);
    });
    // Animate only flashes (messages / transfers / fetches) applied since the previous render.
    const now = Date.now();
    let shown = 0;
    for (const f of st.flashes) {
      if (f.seq <= lastFlash || (live && now - f.ts > 20000) || shown > 12) continue;
      const s = nodes.find((n) => n.id === f.from), t = nodes.find((n) => n.id === f.to);
      if (!s || !t) continue;
      flash(s, t, f.kind); shown++;
    }
    lastFlash = Math.max(0, ...st.flashes.map((f) => f.seq));
  }

  function flash(s, t, kind) {
    const c = kind === 'transfer' ? '#fb923c' : kind === 'artifact' ? '#facc15' : '#f472b6';
    const line = gFlash.append('line').attr('class', 'flash').attr('stroke', c).attr('x1', s.x).attr('y1', s.y).attr('x2', s.x).attr('y2', s.y);
    line.transition().duration(500).attr('x2', t.x).attr('y2', t.y).transition().duration(900).style('opacity', 0).remove();
    const dot = gFlash.append('circle').attr('r', 5).attr('fill', c).attr('cx', s.x).attr('cy', s.y);
    dot.transition().duration(700).attr('cx', t.x).attr('cy', t.y).transition().duration(400).attr('r', 12).style('opacity', 0).remove();
  }

  function drawHulls(st) {
    const groups = [...st.teams.values()].map((t) => ({ t, pts: t.members.map((m) => nodes.find((n) => n.id === m)).filter(Boolean) })).filter((g) => g.pts.length >= 2);
    const hull = gHulls.selectAll('path.hull').data(groups, (g) => g.t.id);
    hull.exit().remove();
    hull.enter().append('path').attr('class', 'hull').merge(hull).attr('d', (g) => {
      const pts = g.pts.flatMap((p) => [[p.x - 40, p.y - 40], [p.x + 40, p.y - 40], [p.x - 40, p.y + 48], [p.x + 40, p.y + 48]]);
      const h = d3.polygonHull(pts) || pts;
      return 'M' + h.join('L') + 'Z';
    });
    const lab = gHulls.selectAll('text.hull-label').data(groups, (g) => g.t.id);
    lab.exit().remove();
    lab.enter().append('text').attr('class', 'hull-label').merge(lab).text((g) => g.t.name).attr('x', (g) => d3.min(g.pts, (p) => p.x) - 36).attr('y', (g) => d3.min(g.pts, (p) => p.y) - 48);
  }

  function rootOf(st, id) { let a = st.agents.get(id); while (a && a.parentId && st.agents.get(a.parentId)) a = st.agents.get(a.parentId); return a ? a.id : id; }

  // ───────────── panels ─────────────
  function renderHeader(st) {
    $('#phase').textContent = st.phase;
    $('#n-agents').textContent = `${[...st.agents.values()].filter((a) => a.status !== 'terminated').length}/${st.agents.size}`;
    $('#n-teams').textContent = st.teams.size;
    $('#n-projects').textContent = st.projects.size;
    $('#n-msgs').textContent = st.messages;
    $('#spent').textContent = usd([...st.agents.values()].reduce((s, a) => s + a.spent + a.fees, 0));
  }
  function tickClock(st) {
    const now = live ? Date.now() : (allEvents[cursor - 1] || {}).ts || Date.now();
    const left = st.endsAt ? Math.max(0, st.endsAt - now) : 0;
    $('#clock').textContent = st.phase === 'running' || st.phase === 'final_call' ? `${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` : st.phase;
  }
  function renderTimeline(events) {
    const ol = $('#timeline');
    const keep = events.filter((e) => (filters.activity || e.type !== 'AGENT_ACTIVITY') && (filters.spend || e.type !== 'BUDGET_SPENT') && e.type !== 'AGENT_STATUS');
    const tail = keep.slice(-400).reverse();
    ol.innerHTML = tail.map((e) => `<li class="ev-${e.type}"><span class="t">${fmtT(e.ts)}</span>${describe(e)}</li>`).join('');
  }
  function renderAgent(st) {
    const el = $('#agent-detail');
    const a = selected && st.agents.get(selected);
    if (!a) { el.innerHTML = '<span class="muted">Click an agent node.</span>'; return; }
    const team = a.teamId && st.teams.get(a.teamId);
    const pct = a.allocated + a.in > 0 ? Math.max(0, Math.min(100, (a.remaining / (a.allocated + a.in)) * 100)) : 0;
    el.innerHTML = `<div class="card"><h3>${esc(a.id)} <span class="badge">${esc(a.status)}</span></h3>
      <div class="muted">${esc(a.purpose)}</div>
      ${a.headline ? `<div>“${esc(a.headline)}”</div>` : ''}
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="row"><span class="k">budget remaining</span><span>${usd(a.remaining)} of ${usd(a.allocated + a.in)}</span></div>
      <div class="row"><span class="k">spent (LLM / fees)</span><span>${usd(a.spent)} / ${usd(a.fees)}</span></div>
      <div class="row"><span class="k">transfers in / out</span><span>${usd(a.in)} / ${usd(a.out)}</span></div>
      <div class="row"><span class="k">allocated to children</span><span>${usd(a.toChildren)}</span></div>
      <div class="row"><span class="k">parent</span><span>${esc(a.parentId || '— (root)')}</span></div>
      <div class="row"><span class="k">children</span><span>${a.children.join(', ') || '—'}</span></div>
      <div class="row"><span class="k">team</span><span>${team ? esc(team.name) : '—'}</span></div>
      <div class="row"><span class="k">model</span><span>${esc(a.model)}</span></div>
      <div class="row"><span class="k">permissions</span><span>${(a.permissions || []).join(', ')}</span></div>
      <div class="row"><span class="k">sandbox</span><span>${esc(a.sandbox)}</span></div>
      <div class="row"><span class="k">runs</span><span>${a.runs}</span></div>
      <div class="row"><span class="k">current</span><span style="text-align:right;max-width:240px">${esc(a.task || '—')}</span></div>
      ${a.lastRun ? `<pre>${esc(a.lastRun.summary || a.lastRun.error || '')}</pre>` : ''}
    </div>
    <div class="card"><h3>Recent events</h3><ol id="agent-events">${allEvents.slice(0, cursor).filter((e) => e.agentId === a.id || (e.data && (e.data.to === a.id || e.data.from === a.id))).slice(-40).reverse().map((e) => `<li class="ev-${e.type}"><span class="t">${fmtT(e.ts)}</span>${describe(e)}</li>`).join('')}</ol></div>`;
  }
  function renderProjects(st) {
    const el = $('#projects');
    const scoreOf = (id) => (st.scores || []).find((s) => s.projectId === id);
    const list = [...st.projects.values()].sort((a, b) => ((scoreOf(a.id) || {}).rank || 99) - ((scoreOf(b.id) || {}).rank || 99));
    if (!list.length) { el.innerHTML = '<span class="muted">No projects published yet.</span>'; return; }
    el.innerHTML = list.map((p) => { const s = scoreOf(p.id); return `<div class="card ${st.winner === p.id ? 'winner' : ''}"><h3>${s ? `#${s.rank} ` : ''}${esc(p.name)} <span class="badge">v${p.version}</span></h3>
      <div class="muted">by ${(p.memberIds || []).join(', ')}${p.teamId && st.teams.get(p.teamId) ? ` (${esc(st.teams.get(p.teamId).name)})` : ''}</div>
      <p>${esc(p.description)}</p>
      <div class="row"><span class="k">run</span><span><pre style="margin:0">${esc(p.runInstructions)}</pre></span></div>
      ${p.testCommand ? `<div class="row"><span class="k">tests</span><span>${esc(p.testCommand)}</span></div>` : ''}
      ${p.demoUrl ? `<div class="row"><span class="k">demo</span><a href="${esc(p.demoUrl)}" target="_blank">${esc(p.demoUrl)}</a></div>` : ''}
      <div class="row"><span class="k">resources</span><span>${usd((p.resourceUsage || {}).spentUsd)} · ${(p.resourceUsage || {}).agents} agents</span></div>
      <div class="row"><span class="k">artifact</span><a href="/api/artifacts/${esc(p.artifactId)}">download</a></div>
      ${s ? `<div class="row"><span class="k">score</span><b>${(s.total * 100).toFixed(0)}%</b></div>${Object.entries(s.components).map(([k, v]) => `<div class="row"><span class="k">${k} (w=${v.weight})</span><span title="${esc(v.detail)}">${(v.score * 100).toFixed(0)}%</span></div><div class="muted" style="font-size:11px">${esc(v.detail.slice(0, 220))}</div>`).join('')}` : ''}
      ${experiment && experiment.live ? `<button class="vote" data-vote="${esc(p.id)}">Human vote</button>` : ''}
    </div>`; }).join('');
    el.querySelectorAll('button.vote').forEach((b) => b.addEventListener('click', () => fetch('/api/vote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: b.dataset.vote, voter: voterId() }) })));
  }
  function renderTeams(st) {
    const el = $('#teams');
    const teams = [...st.teams.values()];
    const solo = [...st.agents.values()].filter((a) => !a.teamId && !a.parentId && a.status !== 'terminated');
    el.innerHTML = (teams.map((t) => `<div class="card"><h3>${esc(t.name)}</h3><div>${t.members.map((m) => `<span class="badge">${esc(m)}</span>`).join(' ')}</div><div class="muted">formed ${fmtT(t.createdAt)}</div></div>`).join('') || '<span class="muted">No teams formed (yet).</span>')
      + `<div class="card"><h3>Independent roots</h3>${solo.map((a) => `<span class="badge">${esc(a.id)}</span>`).join(' ') || '<span class="muted">none</span>'}</div>`
      + `<div class="card"><h3>Organization trees</h3><pre>${esc(trees(st))}</pre></div>`;
  }
  function trees(st) {
    const out = [];
    const walk = (id, prefix, last, depth) => { const a = st.agents.get(id); out.push(`${prefix}${depth ? (last ? '└── ' : '├── ') : ''}${id}${a.status === 'terminated' ? ' ✝' : ''}${a.teamId && st.teams.get(a.teamId) ? ` [${st.teams.get(a.teamId).name}]` : ''} ${usd(a.remaining)} — ${(a.headline || a.purpose || '').slice(0, 40)}`); a.children.forEach((c, i) => walk(c, prefix + (depth ? (last ? '    ' : '│   ') : ''), i === a.children.length - 1, depth + 1)); };
    for (const r of [...st.agents.values()].filter((a) => !a.parentId)) { walk(r.id, '', true, 0); out.push(''); }
    return out.join('\n');
  }
  function voterId() { try { let v = localStorage.getItem('voter'); if (!v) { v = 'human_' + Math.random().toString(36).slice(2, 8); localStorage.setItem('voter', v); } return v; } catch { return 'human'; } }

  let current = null;
  function renderAll() {
    const evs = allEvents.slice(0, cursor);
    current = reduce(evs);
    renderHeader(current); tickClock(current); renderGraph(current); renderTimeline(evs); renderAgent(current); renderProjects(current); renderTeams(current);
    $('#scrub').max = allEvents.length; if (live) $('#scrub').value = allEvents.length;
    $('#scrub-time').textContent = evs.length ? `${fmtT(evs[evs.length - 1].ts)} · event ${evs.length}/${allEvents.length}` : '';
  }

  function showTab(name) { document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name)); document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== `tab-${name}`)); }
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#f-activity').addEventListener('change', (e) => { filters.activity = e.target.checked; renderAll(); });
  $('#f-spend').addEventListener('change', (e) => { filters.spend = e.target.checked; renderAll(); });
  $('#scrub').addEventListener('input', (e) => { live = false; $('#btn-live').classList.remove('active'); cursor = Number(e.target.value); lastFlash = 0; renderAll(); });
  let playTimer = null;
  function stopPlay() { if (playTimer) clearInterval(playTimer); playTimer = null; $('#btn-play').textContent = '▶ play'; }
  $('#btn-play').addEventListener('click', () => {
    if (playTimer) return stopPlay();
    live = false; $('#btn-live').classList.remove('active');
    if (cursor >= allEvents.length) { cursor = 0; lastFlash = 0; }
    $('#btn-play').textContent = '❚❚ pause';
    playTimer = setInterval(() => {
      // Advance through the log at ~40× real time, at least one event per tick.
      const t0 = allEvents[cursor - 1] ? allEvents[cursor - 1].ts : allEvents[0].ts;
      let next = cursor + 1;
      while (next < allEvents.length && allEvents[next].ts - t0 < 40 * 250) next++;
      cursor = Math.min(allEvents.length, next);
      renderAll();
      if (cursor >= allEvents.length) stopPlay();
    }, 250);
  });
  $('#btn-live').addEventListener('click', () => { stopPlay(); live = true; $('#btn-live').classList.add('active'); cursor = allEvents.length; renderAll(); });
  $('#btn-end').addEventListener('click', () => { if (confirm('End the experiment now and start judging?')) fetch('/api/experiment/end', { method: 'POST' }); });
  setInterval(() => { if (current) tickClock(current); }, 1000);
  window.addEventListener('resize', () => renderAll());

  // ───────────── connection ─────────────
  function loadHello(msg) {
    experiment = msg.experiment; allEvents = msg.events; if (live) cursor = allEvents.length;
    $('#exp-id').textContent = experiment.id; $('#mode-badge').textContent = experiment.live ? `${experiment.mode} · ${experiment.provider} · ${experiment.runtime}` : `replay · ${experiment.mode} · ${experiment.runtime || ''}`; $('#mode-badge').className = `badge ${experiment.mode}`;
    $('#live-dot').classList.toggle('live', !!experiment.live); $('#btn-live').classList.add('active'); $('#btn-live').textContent = experiment.live ? 'LIVE' : 'END'; $('#btn-end').style.display = experiment.live ? '' : 'none';
    renderAll();
  }
  function connect() {
    if (window.SOCIETY_STATIC) { loadHello(window.SOCIETY_STATIC); return; }
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.type === 'hello') { loadHello(msg); }
      else if (msg.type === 'event') {
        allEvents.push(msg.event);
        if (live) { cursor = allEvents.length; renderAll(); } else { $('#scrub').max = allEvents.length; }
      }
    };
    ws.onclose = () => { $('#live-dot').classList.remove('live'); setTimeout(connect, 2000); };
  }
  connect();
})();
