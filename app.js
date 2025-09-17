// app.js — DS AI Chat-First Build "Free Brain" (No Autopilot, No Fallbacks, No Retries)
// GPT is the only brain: it must always emit narration (3–5 lines), ops, and (if open-ended) exactly 3 choices.
// The client applies whatever ops are returned. If GPT returns bad/missing ops, nothing is applied.
// Sidebar-safe layout; race sim strict JSON. Keep it simple.

import { bootGame, loadGame, exportBundle } from './loader.js';

/* ────────────────────────────────────────────────────────────────────────────
   GAME CONTRACT (Lean)
   1) New game starts at season=2025, timeline='preseason', last_completed_round=0
   2) Next race chosen by round > last_completed_round (ignore dates)
   3) Chat MUST return JSON: { narration, ops, (optional) choices }
   4) After any OPS that modify results, recompute & store standings
   5) Standings team names map to roster teams (normalize/force mapping)
   6) On boot/resume, announce current stage
   ──────────────────────────────────────────────────────────────────────────── */

const CFG = {
  DEBUG: true,
  START_SEASON: 2025,
  START_TIMELINE: 'preseason',
  START_ROUND: 0,
  FORCE_ROSTER_TEAMS: true,
};

let game = null;
function setGame(newGame) { game = newGame; }
function saveLocal(state) { try { localStorage.setItem('ccsf_state', JSON.stringify(state)); } catch {} }
function loadLocal() {
  try { const raw = localStorage.getItem('ccsf_state'); if (!raw) return null;
        const state = JSON.parse(raw); if (!state?.meta?.season) return null; return state;
  } catch { return null; }
}
function ensureStatsScaffold(state) {
  if (!state) return;
  state.stats = state.stats || {};
  state.stats.race_results = state.stats.race_results || [];
}
if (typeof window.announce !== 'function') {
  window.announce = (msg) => {
    console.log('[ANNOUNCE]', msg);
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.style.cssText = 'position:fixed;left:12px;bottom:12px;background:#222;color:#fff;padding:10px 12px;border-radius:8px;z-index:9999;max-width:60ch;font:14px/1.3 system-ui';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = 'block';
    setTimeout(() => (t.style.display = 'none'), 2200);
  };
}
function announceStage(state) {
  const m = state?.meta || {};
  announce(`📅 ${m.season ?? '?'} — ${m.timeline ?? '?'} (last_completed_round: ${m.last_completed_round ?? 0})`);
}

/* ---- Debug to chat ---- */
function logApiToChat(title, info) {
  if (!CFG.DEBUG) return;
  try {
    const pretty = typeof info === 'string' ? info : JSON.stringify(info, null, 2);
    addMessage('assistant', `🔎 ${title}\n${pretty}`);
  } catch {
    addMessage('assistant', `🔎 ${title} (unprintable)`);
  }
}

/* ----------------------- Slim context for GPT ----------------------- */
function getSeedContext() {
  const s = (typeof game?.state !== 'undefined') ? game.state
            : JSON.parse(localStorage.getItem('ccsf_state') || 'null');
  if (!s) return null;

  const pick = (obj, keys) => {
    if (!obj) return undefined; const out = {};
    for (const k of keys) if (k in obj) out[k] = obj[k];
    return Object.keys(out).length ? out : undefined;
  };

  const teams = (s.teams || []).map(t => ({
    id: t.team_id, name: t.team_name, principal: t.team_principal,
    drivers: t.drivers, engineers: t.race_engineers, engine: t.engine_supplier,
    sponsors: (t.sponsors || []).slice(0, 5),
    finance: t.finance ? {
      balance_usd: Math.round(t.finance.balance_usd),
      budget_cap_remaining_usd: Math.round(t.finance.budget_cap_remaining_usd)
    } : undefined,
    car: t.car || undefined
  }));

  const drivers = (s.drivers || []).map(d => ({
    id: d.driver_id, name: d.name, team: d.team, age: d.age,
    rating: d.overall_rating, form: d.form
  }));

  const principals = (s.principals || []).map(p => ({
    id: p.tp_id, name: p.name, team: p.team,
    attrs: pick(p.attrs, ['leadership','politics','media','dev_focus','risk'])
  }));

  const engineers = (s.engineers || []).map(e => ({
    id: e.re_id, name: e.name, team: e.team, driver: e.driver,
    attrs: pick(e.attrs, ['tyre_management','racecraft','strategy','comms'])
  }));

  const calendar = (s.calendar || []).map(c => ({
    round: c.round, name: c.name, date: c.date, country: c.country,
    attrs: pick(c.attrs, ['downforce','tyre_wear','brake_severity','power_sensitivity'])
  }));

  const regs = s.regulations ? pick(s.regulations, [
    'budget_cap_usd','wind_tunnel_hours_base','points_system','penalties_policy'
  ]) : undefined;

  const stats = s.stats ? {
    have_results: !!s.stats.race_results,
    have_standings: !!s.stats.driver_standings
  } : undefined;

  return {
    meta: { season: s.meta?.season, timeline: s.meta?.timeline, selected_team: s.meta?.selected_team || null },
    regs, teams, drivers, principals, engineers,
    calendar, next_race: null, stats
  };
}

/* ----------------------- Next race by round ----------------------- */
function nextRaceByRound(state) {
  const cal = Array.isArray(state?.calendar) ? state.calendar : [];
  const rr  = Array.isArray(state?.stats?.race_results) ? state.stats.race_results : [];
  const lastDone = Math.max(
    Number(state?.meta?.last_completed_round || 0),
    rr.reduce((m,r)=>Math.max(m, Number(r?.round||0)), 0)
  );
  return cal.find(c => Number(c.round) > lastDone) || cal[0] || null;
}

/* ----------------------- Race slice for GPT ----------------------- */
function buildRaceSliceForPrompt(s) {
  const next = nextRaceByRound(s) || { round: 1, name: 'Test Track', date: '2025-01-01', country: '—', attrs: {} };

  const teams = (s?.teams || []).map(t => ({
    id: t.team_id, name: t.team_name,
    car: t.car ? {
      aero_efficiency: t.car.aero_efficiency,
      drag: t.car.drag,
      engine_power: t.car.engine_power,
      mechanical_grip: t.car.mechanical_grip,
      energy_recovery: t.car.energy_recovery,
      tyre_degradation: t.car.tyre_degradation,
      brake_cooling: t.car.brake_cooling,
      reliability: t.car.reliability,
      setup_window: t.car.setup_window
    } : undefined
  }));

  const drivers = (s?.drivers || []).map d => ({
    name: d.name, team: d.team,
    rating: d.overall_rating, form: d.form,
    pace_mod: d.pace_mod, quali_mod: d.quali_mod, wet_mod: d.wet_mod
  });

  const results = Array.isArray(s?.stats?.race_results) ? s.stats.race_results : [];

  return {
    next_race: { round: next.round, name: next.name, date: next.date, country: next.country, attrs: next.attrs || {} },
    teams, drivers,
    tyres: s?.tyres || s?.tires || undefined,
    weather: s?.weather || undefined,
    recent_results: results.slice(-3),
  };
}

/* ----------------------- Clean narration ----------------------- */
function cleanNarration(s) {
  if (!s) return '';
  return String(s).replace(/```[\s\S]*?```/g, '').replace(/`/g, '').trim();
}

/* ----------------------- Validate payload ----------------------- */
function validateOpsPayload(payload) {
  if (!payload || typeof payload !== 'object') return { ok:false, reason:'no-payload' };
  if (!('narration' in payload)) return { ok:false, reason:'no-narration' };
  const ops = payload.ops;
  if (!ops) return { ok:false, reason:'no-ops' };
  if (ops._type !== 'ccsf_ops_v1' || !Array.isArray(ops.changes)) {
    return { ok:false, reason:'bad-ops-shape' };
  }
  return { ok:true, ops };
}

/* ----------------------- Apply ops ----------------------- */
function applyOps(state, ops) {
  const changedPaths = [];
  if (!ops || ops._type !== 'ccsf_ops_v1' || !Array.isArray(ops.changes)) {
    return { ok: false, changed: changedPaths, reason: 'no-ops' };
  }
  const toKeys = (path) => {
    if (!path) return [];
    const p = path.startsWith('/') ? path.slice(1) : path.replaceAll('.', '/');
    return p.split('/').filter(Boolean);
  };
  const ensureRef = (root, keys) => {
    let obj = root;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (obj[k] == null || typeof obj[k] !== 'object') obj[k] = {};
      obj = obj[k];
    }
    return [obj, keys[keys.length - 1]];
  };
  const clampIfCarAttr = (path, v) => {
    if (typeof v !== 'number') return v;
    return path.includes('/car/') ? Math.max(0, Math.min(100, v)) : v;
  };
  for (const c of ops.changes) {
    const keys = toKeys(c.path);
    const [obj, key] = ensureRef(state, keys);
    if (!obj || key == null) continue;
    if (c.op === 'set') {
      obj[key] = clampIfCarAttr(c.path, c.value);
      changedPaths.push(c.path);
    } else if (c.op === 'inc') {
      const current = typeof obj[key] === 'number' ? obj[key] : 0;
      obj[key] = clampIfCarAttr(c.path, current + Number(c.value || 0));
      changedPaths.push(c.path);
    } else if (c.op === 'push') {
      if (!Array.isArray(obj[key])) obj[key] = [];
      obj[key].push(c.value);
      changedPaths.push(c.path);
    }
  }
  return { ok: changedPaths.length > 0, changed: changedPaths };
}

/* ----------------------- Standings recompute ----------------------- */
function normalizePointsSystem(ps) {
  const fallback = { 1:25, 2:18, 3:15, 4:12, 5:10, 6:8, 7:6, 8:4, 9:2, 10:1 };
  if (!ps) return fallback;
  if (Array.isArray(ps)) {
    const obj = {}; for (let i = 0; i < ps.length; i++) obj[i+1] = Number(ps[i] || 0); return Object.keys(obj).length ? obj : fallback;
  }
  if (typeof ps === 'object') {
    const obj = {};
    for (const k of Object.keys(ps)) obj[Number(k)] = Number(ps[k] || 0);
    for (const k of Object.keys(ps)) { const m = /^p(\d+)$/i.exec(k); if (m) obj[Number(m[1])] = Number(ps[k] || 0); }
    return Object.keys(obj).length ? obj : fallback;
  }
  return fallback;
}
function computeStandingsFromResults(s) {
  const results = Array.isArray(s?.stats?.race_results) ? s.stats.race_results : [];
  const ptsMap = normalizePointsSystem(s?.regulations?.points_system);
  const drv = new Map(); const tm  = new Map();
  const roster = Array.isArray(s?.drivers) ? s.drivers : [];
  const rosterTeams = Array.isArray(s?.teams) ? s.teams.map(t => t.team_name || t.name) : [];
  const teamByDriverName = new Map(roster.map(d => [String(d.name), d.team || d.constructor || '—']));
  const teamByDriverId   = new Map(roster.map(d => [String(d.driver_id ?? d.name), d.team || d.constructor || '—']));

  const tokenize = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(' ').filter(Boolean);
  const normTeam = (name) => {
    if (!name) return '—';
    for (const t of rosterTeams) if (String(t).toLowerCase() === String(name).toLowerCase()) return t;
    const nToks = tokenize(name);
    let best = null, bestScore = 0;
    for (const t of rosterTeams) {
      const score = tokenize(t).filter(w => nToks.includes(w)).length;
      if (score > bestScore) { best = t; bestScore = score; }
    }
    return best || name;
  };

  for (const race of results) {
    const list = race?.finishers || race?.classification || race?.results || race?.grid || [];
    if (!Array.isArray(list)) continue;
    const sorted = list.slice().sort((a,b) => {
      const pa = Number(a.position ?? a.pos ?? a.p) || 9999;
      const pb = Number(b.position ?? b.pos ?? b.p) || 9999;
      return pa - pb;
    });
    sorted.forEach((entry, idx) => {
      const name = entry.driver || entry.name || entry.driver_name || entry.id || entry.driver_id;
      if (!name) return;
      const key = String(name);
      const pos = Number(entry.position ?? entry.pos ?? entry.p ?? (idx + 1));
      const explicitTeam = normTeam(entry.team || entry.constructor || '—');
      const rosterTeam = normTeam(
        teamByDriverName.get(String(entry.name)) ||
        teamByDriverId.get(String(entry.driver_id ?? entry.id ?? key)) || explicitTeam
      );
      const team = CFG.FORCE_ROSTER_TEAMS ? (rosterTeam || explicitTeam) : (explicitTeam || rosterTeam);
      const pts = Number(entry.points ?? entry.pts ?? ptsMap[pos] ?? 0);

      const drow = drv.get(key) || { driver:key, team, points:0, wins:0, podiums:0 };
      drow.points += pts; if (pos === 1) drow.wins += 1; if (pos <= 3) drow.podiums += 1; drow.team = team; drv.set(key, drow);
      const trow = tm.get(team) || { team, points:0, wins:0, podiums:0 };
      trow.points += pts; if (pos === 1) trow.wins += 1; if (pos <= 3) trow.podiums += 1; tm.set(trow.team, trow);
    });
  }

  const drivers = [...drv.values()]
    .map(r => {
      const pretty = roster.find(d => String(d.driver_id) == String(r.driver) or String(d.name) == String(r.driver));
      return { ...r, driver: pretty?.name || r.driver, team: pretty?.team || r.team };
    })
    .sort((a,b) => (b.points - a.points) || ((b.wins||0) - (a.wins||0)));

  const teams   = [...tm.values()]
    .sort((a,b) => (b.points - a.points) || ((b.wins||0) - (a.wins||0)));

  return { drivers, teams };
}
function recomputeAndStoreStandings(state) {
  try {
    const { drivers, teams } = computeStandingsFromResults(state);
    state.stats = state.stats || {};
    state.stats.driver_standings = drivers.map(r => ({
      driver: r.driver, team: r.team, points: r.points, wins: r.wins||0, podiums: r.podiums||0
    }));
    state.stats.constructor_standings = teams.map(r => ({
      team: r.team, points: r.points, wins: r.wins||0, podiums: r.podiums||0
    }));
    return true;
  } catch (e) { console.error('standings recompute failed', e); return false; }
}
function onOpsApplied(state) {
  const rr = Array.isArray(state?.stats?.race_results) ? state.stats.race_results : [];
  const latestRound = rr.length ? Number(rr[rr.length - 1]?.round || 0) : 0;
  state.meta = state.meta || {};
  if (latestRound > Number(state.meta.last_completed_round || 0)) {
    state.meta.last_completed_round = latestRound;
    if (state.meta.timeline === 'preseason' && latestRound > 0) state.meta.timeline = 'inseason';
  }
  recomputeAndStoreStandings(state);
  try { localStorage.setItem('ccsf_state', JSON.stringify(state)); } catch {}
  tryRenderStandingsTabs();
  announceStage(state);
  updateSidebar(state);
}
function sanityCheckAndRepair(state) {
  let warnings = [];
  state.meta = state.meta || {};
  if (state.meta.season == null) { state.meta.season = CFG.START_SEASON; warnings.push('season->defaulted'); }
  if (!state.meta.timeline) { state.meta.timeline = CFG.START_TIMELINE; warnings.push('timeline->defaulted'); }
  if (state.meta.last_completed_round == null) { state.meta.last_completed_round = CFG.START_ROUND; warnings.push('pointer->defaulted'); }
  state.stats = state.stats || {};
  if (!Array.isArray(state.stats.race_results)) state.stats.race_results = [];
  const needDrivers = !Array.isArray(state.stats.driver_standings) || !state.stats.driver_standings.length;
  const needTeams   = !Array.isArray(state.stats.constructor_standings) || !state.stats.constructor_standings.length;
  if (needDrivers || needTeams) { recomputeAndStoreStandings(state); warnings.push('standings->recomputed'); }
  if (warnings.length) announce('⚠️ Sanity check: ' + [...new Set(warnings)].join(', '));
  return state;
}

/* ----------------------- UI: Chat ----------------------- */
const STORAGE_KEY = 'pwa-chatgpt-history-v1';
let chatEl, inputEl, sendBtn, clearBtn, tpl;
let history = [];
function now() { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function addMessage(role, content, time = now()) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.classList.toggle('user', role === 'user');
  node.querySelector('.content').textContent = content;
  node.querySelector('.balloon').insertAdjacentHTML('beforeend', `<span class="time">${time}</span>`);
  chatEl.appendChild(node);
  chatEl.scrollTop = chatEl.scrollHeight;
}
function restoreChat() {
  history = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (history.length === 0) { addMessage('assistant', 'Oi boss, welcome to preseason. Say the word.'); return; }
  history.forEach(m => addMessage(m.role, m.content, m.time));
}

/* ----------------------- UI: Standings Tabs ----------------------- */
function injectStandingsTabs() {
  if (document.getElementById('ccsf_tabs')) return;
  const wrap = document.createElement('div');
  wrap.id = 'ccsf_tabs';
  wrap.style.cssText = `
    position:fixed; left:12px; top:12px; z-index:9998; width: min(900px, 92vw);
    background:#0e0e10; color:#eaeaea; border:1px solid #2a2a2a; border-radius:10px; box-shadow:0 6px 28px rgba(0,0,0,.45);
    font:12px/1.35 system-ui; user-select:text; overflow:hidden
  `;
  wrap.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px; padding:8px 10px; background:#141414; border-bottom:1px solid #222">
      <strong style="font:600 13px system-ui;">📊 Live Paddock</strong>
      <div id="ccsf_tabbar" style="display:flex; gap:6px; margin-left:12px;"></div>
      <div style="margin-left:auto; display:flex; gap:8px;">
        <button id="ccsf_refresh" style="background:#1f1f1f;border:1px solid #333;color:#ddd;padding:4px 8px;border-radius:6px;cursor:pointer;">Refresh</button>
        <button id="ccsf_collapse" style="background:#1f1f1f;border:1px solid #333;color:#ddd;padding:4px 8px;border-radius:6px;cursor:pointer;">—</button>
        <button id="ccsf_close" style="background:#1f1f1f;border:1px solid #333;color:#ddd;padding:4px 8px;border-radius:6px;cursor:pointer;">✕</button>
      </div>
    </div>
    <div id="ccsf_panel" style="background:#0e0e10; padding:10px 10px 12px; max-height:60vh; overflow:auto;"></div>
  `;
  document.body.appendChild(wrap);

  const tabs = [
    { id:'drivers',  label:'Drivers' },
    { id:'drv_std',  label:'Driver Standings' },
    { id:'tm_std',   label:'Team Standings' },
  ];
  const tabbar = wrap.querySelector('#ccsf_tabbar');
  tabs.forEach(t => {
    const b = document.createElement('button');
    b.textContent = t.label;
    b.dataset.id = t.id;
    b.style.cssText = `background:#1a1a1a;border:1px solid #333;color:#e0e0e0;padding:4px 8px;border-radius:6px;cursor:pointer`;
    b.addEventListener('click', () => renderTab(t.id));
    tabbar.appendChild(b);
  });
  wrap.querySelector('#ccsf_close').onclick = () => wrap.remove();
  wrap.querySelector('#ccsf_collapse').onclick = (e) => {
    const p = wrap.querySelector('#ccsf_panel');
    const btn = e.currentTarget;
    if (p.style.display === 'none') { p.style.display = 'block'; btn.textContent = '—'; }
    else { p.style.display = 'none'; btn.textContent = '+'; }
  };
  wrap.querySelector('#ccsf_refresh').onclick = () => {
    announce('🔄 Refreshed from current save');
    const active = wrap.dataset.active || 'drivers';
    renderTab(active);
  };
  function renderTab(id) {
    wrap.dataset.active = id;
    [...tabbar.children].forEach(b => b.style.background = (b.dataset.id === id) ? '#2a2a2a' : '#1a1a1a');
    const panel = wrap.querySelector('#ccsf_panel');
    if (!game?.state) { panel.textContent = 'No game state'; return; }
    if (id === 'drivers')      return panel.replaceChildren(buildDriversTable(game.state));
    if (id === 'drv_std')      return panel.replaceChildren(buildDriverStandingsTable(game.state));
    if (id === 'tm_std')       return panel.replaceChildren(buildTeamStandingsTable(game.state));
  }
  renderTab('drivers');
}
function tryRenderStandingsTabs() {
  const root = document.getElementById('ccsf_tabs'); if (!root) return;
  const active = root.dataset.active || 'drivers';
  const panel = root.querySelector('#ccsf_panel'); if (!panel) return;
  if (!game?.state) { panel.textContent = 'No game state'; return; }
  if (active === 'drivers')      panel.replaceChildren(buildDriversTable(game.state));
  if (active === 'drv_std')      panel.replaceChildren(buildDriverStandingsTable(game.state));
  if (active === 'tm_std')       panel.replaceChildren(buildTeamStandingsTable(game.state));
}

/* ---------- Table builders ---------- */
function mkTable(headers, rows) {
  const table = document.createElement('table');
  table.style.cssText = 'width:100%; border-collapse:collapse; font:12px/1.35 system-ui';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th'); th.textContent = h;
    th.style.cssText = 'text-align:left; padding:6px 8px; border-bottom:1px solid #2a2a2a; position:sticky; top:0; background:#111';
    trh.appendChild(th);
  });
  thead.appendChild(trh); table.appendChild(thead);
  const tbody = document.createElement('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    r.forEach((cell,i) => {
      const td = document.createElement('td');
      td.textContent = (cell ?? '').toString();
      td.style.cssText = 'padding:6px 8px; border-bottom:1px dashed #1f1f1f;';
      if (i == 0) td.style.color = '#aaa';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}
function wrapTable(title, tbl, icon='📊') {
  const box = document.createElement('div');
  const h = document.createElement('div');
  h.innerHTML = `<strong style="font:600 13px system-ui">${icon} ${title}</strong>`;
  h.style.cssText = 'margin:0 0 8px 2px; color:#ddd';
  box.appendChild(h); box.appendChild(tbl); return box;
}
function buildDriversTable(s) {
  const drivers = (s.drivers || []).map(d => ({
    name: d.name, team: d.team, age: d.age, rating: d.overall_rating, form: d.form
  }));
  const tbl = mkTable(['#','Driver','Team','Age','Rating','Form'],
    drivers.sort((a,b) => (b.rating ?? 0) - (a.rating ?? 0))
           .map((d,i) => [i+1, d.name, d.team, d.age ?? '-', d.rating ?? '-', d.form ?? '-'])
  );
  return wrapTable('Driver List', tbl, '👤');
}
function buildDriverStandingsTable(s) {
  const standings = getDriverStandings(s);
  const tbl = mkTable(['Pos','Driver','Team','Points','Wins','Podiums'],
    standings.map((r,i) => [i+1, r.driver, r.team, r.points, r.wins||0, r.podiums||0])
  );
  return wrapTable('Driver Standings', tbl, '🏁');
}
function buildTeamStandingsTable(s) {
  const standings = getTeamStandings(s);
  const tbl = mkTable(['Pos','Team','Points','Wins','Podiums'],
    standings.map((r,i) => [i+1, r.team, r.points, r.wins||0, r.podiums||0])
  );
  return wrapTable('Constructor Standings', tbl, '🏭');
}
function getDriverStandings(s) {
  const direct = s?.stats?.driver_standings || s?.stats?.drivers_standings || s?.stats?.standings?.drivers || [];
  if (Array.isArray(direct) && direct.length) {
    return direct.map(x => ({
      driver: x.driver || x.name || x.driver_name || x.id || x.driver_id || '—',
      team: x.team || x.constructor || x.squad || '—',
      points: Number(x.points ?? x.pts ?? 0),
      wins: Number(x.wins ?? 0),
      podiums: Number(x.podiums ?? x.pods ?? 0),
    })).sort((a,b) => (b.points - a.points) || ((b.wins||0) - (a.wins||0)));
  }
  return computeStandingsFromResults(s).drivers;
}
function getTeamStandings(s) {
  const direct = s?.stats?.constructor_standings || s?.stats?.team_standings || s?.stats?.standings?.teams || [];
  if (Array.isArray(direct) && direct.length) {
    return direct.map(x => ({
      team: x.team || x.name || x.constructor || '—',
      points: Number(x.points ?? x.pts ?? 0),
      wins: Number(x.wins ?? 0),
      podiums: Number(x.podiums ?? x.pods ?? 0),
    })).sort((a,b) => (b.points - a.points) || ((b.wins||0) - (a.wins||0)));
  }
  return computeStandingsFromResults(s).teams;
}

/* ----------------------- SIDEBAR Dashboard ----------------------- */
function injectSidebar() {
  if (document.getElementById('dashboard-sidebar')) return;
  const sidebar = document.createElement('div');
  sidebar.id = 'dashboard-sidebar';
  sidebar.style.cssText = `
    position:fixed; top:0; left:0; width:220px; height:100vh;
    background:#17171b; color:#eaeaea; border-right:1px solid #23232b;
    box-shadow:2px 0 18px rgba(0,0,0,.08); z-index:9997; padding:24px 16px 16px 14px;
    font:15px/1.5 system-ui; display:flex; flex-direction:column; gap:18px;
  `;
  sidebar.innerHTML = `
    <div style="font-weight:700;font-size:1.2em;letter-spacing:.5px;">🏎️ F1 Chaos Dashboard</div>
    <div id="sb-next" style="background:#111216;border:1px solid #262833;border-radius:10px;padding:10px 10px 8px;">
      <div style="font:600 12px system-ui; color:#bdbdcc; margin-bottom:4px;">📅 Next Race</div>
      <div id="sb-next-title" style="font:700 13px/1.25 system-ui;">—</div>
      <div id="sb-next-meta"  style="color:#9ca0ad; font:12px/1.25 system-ui; margin-top:2px;">—</div>
    </div>
    <div id="sb-last" style="color:#b0b0b7; font:12px/1.25 system-ui;">Last: none (preseason)</div>
    <nav style="display:flex;flex-direction:column;gap:8px;margin-top:4px;">
      <button id="sb-drivers"   style="background:none;border:none;color:#eaeaea;text-align:left;cursor:pointer;font:inherit;padding:4px 0;">Drivers</button>
      <button id="sb-teams"     style="background:none;border:none;color:#eaeaea;text-align:left;cursor:pointer;font:inherit;padding:4px 0;">Teams</button>
      <button id="sb-standings" style="background:none;border:none;color:#eaeaea;text-align:left;cursor:pointer;font:inherit;padding:4px 0;">Standings</button>
      <button id="sb-calendar"  style="background:none;border:none;color:#eaeaea;text-align:left;cursor:pointer;font:inherit;padding:4px 0;">Calendar</button>
      <button id="sb-refresh"   style="margin-top:6px;background:#1f1f1f;border:1px solid #333;color:#ddd;padding:4px 8px;border-radius:6px;cursor:pointer;">↻ Refresh</button>
    </nav>
    <div id="sb-season-info" style="margin-top:4px;font-size:.96em;color:#b0b0b7;"></div>
  `;
  document.body.appendChild(sidebar);

  // shift chat UI to the right so it isn't hidden under the sidebar
  const chatRoot = document.getElementById('chat'); if (chatRoot) chatRoot.style.marginLeft = '220px';
  const inputBox = document.getElementById('input'); if (inputBox) inputBox.style.marginLeft = '220px';

  document.getElementById('sb-drivers').onclick = () => { injectStandingsTabs(); document.querySelector('#ccsf_tabs [data-id="drivers"]')?.click(); };
  document.getElementById('sb-teams').onclick   = () => { injectStandingsTabs(); document.querySelector('#ccsf_tabs [data-id="tm_std"]')?.click(); };
  document.getElementById('sb-standings').onclick= () => { injectStandingsTabs(); document.querySelector('#ccsf_tabs [data-id="drv_std"]')?.click(); };
  document.getElementById('sb-calendar').onclick = () => { announce('🗓️ Calendar view coming soon!'); };
  document.getElementById('sb-refresh').onclick  = () => updateSidebar(game?.state);
  updateSidebar(game?.state);
}
function updateSidebar(state) {
  const seasonEl = document.getElementById('sb-season-info');
  const nextTitle = document.getElementById('sb-next-title');
  const nextMeta  = document.getElementById('sb-next-meta');
  const lastEl    = document.getElementById('sb-last');
  if (!seasonEl || !nextTitle || !nextMeta || !lastEl) return;
  if (!state) {
    seasonEl.innerHTML = `<div><strong>Season:</strong> —</div><div><strong>Timeline:</strong> —</div><div><strong>Last Round:</strong> —</div>`;
    nextTitle.textContent = '—'; nextMeta.textContent = '—'; lastEl.textContent = 'Last: none'; return;
  }
  const m = state.meta || {};
  seasonEl.innerHTML = `
    <div><strong>Season:</strong> ${m.season ?? "?"}</div>
    <div><strong>Timeline:</strong> ${m.timeline ?? "?"}</div>
    <div><strong>Last Round:</strong> ${m.last_completed_round ?? 0}</div>
  `;
  const next = nextRaceByRound(state);
  if (next) {
    nextTitle.textContent = `Round ${next.round} — ${next.name}`;
    const when = next.date ? new Date(next.date).toDateString() : '';
    nextMeta.textContent = `${when}${next.country ? ` • ${next.country}` : ''}`;
  } else { nextTitle.textContent = 'Season complete'; nextMeta.textContent = ''; }
  const rr = Array.isArray(state?.stats?.race_results) ? state.stats.race_results : [];
  const last = rr.at(-1);
  lastEl.textContent = last ? `Last: Round ${last.round} — ${last.name}` : 'Last: none (preseason)';
}

/* ----------------------- RACE button & flow ----------------------- */
function injectRaceButton() {
  if (document.getElementById('race-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'race-btn'; btn.textContent = 'RACE'; btn.title = 'Simulate next race (quali + GP)';
  btn.style.cssText = `position:fixed; left:12px; bottom:12px; z-index:9999; padding:10px 14px; border-radius:10px; border:1px solid #333; cursor:pointer; font:700 14px/1 system-ui; letter-spacing:.5px; background:#c1121f; color:#fff; box-shadow:0 3px 14px rgba(0,0,0,.35)`;
  btn.addEventListener('click', runRaceSim);
  document.body.appendChild(btn);
}

async function runRaceSim() {
  if (!game?.state) return announce('😵 No game state to simulate.');
  ensureStatsScaffold(game.state);

  const uMsg = { role:'user', content:'Simulate qualifying and race at the next event.', time: now() };
  history.push(uMsg); addMessage('user', uMsg.content, uMsg.time);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  addMessage('assistant', 'Thinking…', now());
  const thinkingEl = chatEl.lastElementChild.querySelector('.content'); thinkingEl.classList.add('thinking');

  try {
    const stateNow  = sanityCheckAndRepair(game.state);
    const raceSlice = buildRaceSliceForPrompt(stateNow);
    const slim      = getSeedContext();

    const rosterDrivers = (stateNow?.drivers || []).map(d => d.name).filter(Boolean);
    const rosterTeams   = (stateNow?.teams || []).map(t => t.team_name || t.name).filter(Boolean);
    const ptsObj = (() => {
      const ps = stateNow?.regulations?.points_system;
      if (Array.isArray(ps)) return Object.fromEntries(ps.map((v,i)=>[i+1, Number(v||0)]));
      if (ps and typeof ps === 'object') {
        const o = {};
        Object.keys(ps).forEach(k => { const m = /^p?(\d+)$/i.exec(k); if (m) o[Number(m[1])] = Number(ps[k]||0); });
        return o;
      }
      return {1:25,2:18,3:15,4:12,5:10,6:8,7:6,8:4,9:2,10:1};
    })();

    const nxt = raceSlice.next_race;

    const systemPrompt =
      'You are DS AI, the strategist for an F1 management sim.\\n' +
      'Return STRICT JSON ONLY: { \"narration\": string, \"ops\": { \"_type\":\"ccsf_ops_v1\", \"changes\":[ ... ] } }.\\n' +
      'Narration: 2–4 short sentences, witty/cynical paddock vibe. No code blocks.\\n' +
      'Use ONLY these roster names. If a name is missing, replace with the closest roster driver.\\n' +
      'Allowed drivers=' + JSON.stringify(rosterDrivers) + '\\n' +
      'Allowed teams=' + JSON.stringify(rosterTeams) + '\\n' +
      'Points per position (1-based)=' + JSON.stringify(ptsObj) + '\\n' +
      'Simulate QUALIFYING + RACE for the NEXT EVENT using race_context. ' +
      'WRITE a PUSH to /stats/race_results with: { \"round\": ' + JSON.stringify(nxt?.round or 1) + ', \"name\": ' + JSON.stringify(nxt?.name or 'Unknown') + ', \"finishers\":[{\"driver\":\"<roster>\",\"team\":\"<team>\",\"position\":1,\"points\":<from table>}, ...] }.\\n' +
      'Keep car attrs 0–100. If crucial data is missing, ask ONE short follow-up in \"narration\" and set ops empty.\\n' +
      'game_state_slim=' + JSON.stringify(slim) + '\\n' +
      'race_context=' + JSON.stringify(raceSlice);

    const res = await fetch('api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role:'system', content: systemPrompt },
          { role:'user',   content: 'Simulate qualifying and the race for the next event NOW. Return STRICT JSON only as specified.' }
        ]
      })
    });

    const raw = await res.text();
    logApiToChat('RACE api/chat status', res.status + (res.ok ? ' OK' : ' ERROR'));
    logApiToChat('RACE api/chat body (first 800 chars)', raw.slice(0, 800));
    if (!res.ok) { thinkingEl.classList.remove('thinking'); thinkingEl.textContent = `❌ Chat API HTTP ${res.status}.`; return; }

    let data = null; try { data = JSON.parse(raw); } catch {}
    let reply = (data && data.reply) ? data.reply : raw;

    let payload = null;
    if (typeof reply === 'string') {
      const start = reply.indexOf('{'); const end = reply.lastIndexOf('}');
      if (start !== -1 and end !== -1) { try { payload = JSON.parse(reply.slice(start, end + 1)); } catch {} }
    } else if (reply && typeof reply === 'object') { payload = reply; }

    logApiToChat('RACE parsed payload', payload);
    const check = validateOpsPayload(payload);
    logApiToChat('RACE ops validation', check);

    let outText = cleanNarration(payload?.narration || 'OK');

    if (!check.ok) {
      thinkingEl.classList.remove('thinking');
      thinkingEl.textContent = outText || `🤖 Malformed or missing ops (${check.reason}).`;
      history.push({ role:'assistant', content: thinkingEl.textContent, time: now() });
      return;
    }

    const resOps = applyOps(game.state, check.ops);
    logApiToChat('RACE ops applied', resOps);
    if (resOps.ok) {
      onOpsApplied(game.state);
      outText = (outText || 'Race processed.') + `\\n\\n🧾 Database updated: ${resOps.changed.join(', ')}`;
    } else {
      outText = (outText || 'No state change.') + `\\n\\n(ℹ️ Ops had no effect)`;
    }

    thinkingEl.classList.remove('thinking'); thinkingEl.textContent = outText;
    history.push({ role:'assistant', content: outText, time: now() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (err) {
    thinkingEl.classList.remove('thinking');
    const msg = 'Error: ' + (err?.message || 'Failed to reach /api/chat');
    thinkingEl.textContent = msg;
    logApiToChat('RACE exception', msg);
  }
}

/* ----------------------- General chat (Free Brain) ----------------------- */
async function send() {
  const text = inputEl.value.trim(); if (!text) return; inputEl.value = '';
  const msg = { role: 'user', content: text, time: now() };
  history.push(msg); addMessage('user', text, msg.time);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  addMessage('assistant', 'Thinking…', now());
  const thinkingEl = chatEl.lastElementChild.querySelector('.content'); thinkingEl.classList.add('thinking');

  try {
    const seed = getSeedContext();
    const systemPrompt =
      'You are the ONLY brain of an F1 management sim. Return STRICT JSON ONLY: ' +
      '{"narration": string, "ops": {"_type":"ccsf_ops_v1","changes":[...]}, "choices":[{"id":"A|B|C","label":"...","reply":"..."}]?}.\\n' +
      'Narration: write a few sentences (ideally 3–5), cynical paddock tone; avoid one-word replies.\\n' +
      'If the user intent is open-ended (visit/talk/inspect/try), include exactly 3 creative options. ' +
      'Each option ≤10 words with {"id":"A|B|C","label","reply"}.\\n' +
      'OPS: Always emit ops. Prefer acting over asking: when the user requests a concrete move (transfer/upgrade/talk/visit/negotiate/test), produce best-guess ops using the current roster and plausible defaults. ' +
      'If nothing concrete is possible, push a brief summary event to /events. Use only set/inc/push. Keep car attrs 0–100.\\n' +
      (seed ? ('game_state=' + JSON.stringify(seed)) : '(game_state unavailable)');

    const res = await fetch('api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role:'system', content: systemPrompt },
          ...history.map(({role, content}) => ({role, content}))
        ]
      })
    });

    const raw = await res.text();
    logApiToChat('CHAT status', res.status + (res.ok?' OK':' ERROR'));
    logApiToChat('CHAT body', raw.slice(0, 800));
    if (!res.ok) {
      thinkingEl.classList.remove('thinking'); thinkingEl.textContent = `❌ Chat API HTTP ${res.status}.`;
      history.push({ role:'assistant', content: thinkingEl.textContent, time: now() }); return;
    }

    let data = null; try { data = JSON.parse(raw); } catch {}
    let reply = (data and data.reply) ? data.reply : raw;
    let payload = null;
    if (typeof reply === 'string') {
      const start = reply.indexOf('{'); const end = reply.lastIndexOf('}');
      if (start !== -1 and end !== -1) { try { payload = JSON.parse(reply.slice(start, end + 1)); } catch {} }
    } else if (reply && typeof reply === 'object') { payload = reply; }

    logApiToChat('CHAT parsed payload', payload);
    const check = validateOpsPayload(payload);
    logApiToChat('CHAT ops validation', check);

    let outText = cleanNarration(payload?.narration || 'OK');
    if (!check.ok) {
      thinkingEl.classList.remove('thinking');
      thinkingEl.textContent = outText || `🤖 Malformed or missing ops (${check.reason}).`;
      history.push({ role:'assistant', content: thinkingEl.textContent, time: now() });
      return;
    }

    const resOps = applyOps(game.state, check.ops);
    logApiToChat('CHAT ops applied', resOps);
    if (resOps.ok) {
      onOpsApplied(game.state);
      outText = (outText || 'OK') + `\\n\\n🧾 Database updated: ${resOps.changed.join(', ')}`;
    } else {
      outText = (outText || 'OK') + `\\n\\n(ℹ️ Ops had no effect)`;
    }

    thinkingEl.classList.remove('thinking'); thinkingEl.textContent = outText;
    history.push({ role:'assistant', content: outText, time: now() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));

    // Render interactive choices if provided
    if (payload && Array.isArray(payload.choices) && payload.choices.length) {
      const lastBubble = chatEl.lastElementChild;
      if (lastBubble) {
        const panel = document.createElement('div');
        panel.style.cssText = 'margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;';
        payload.choices.forEach(ch => {
          const b = document.createElement('button');
          b.textContent = (ch.id ? ch.id + ') ' : '') + (ch.label || 'Choose');
          b.style.cssText = 'background:#1f1f1f;border:1px solid #333;color:#ddd;padding:4px 8px;border-radius:6px;cursor:pointer;font:12px system-ui';
          b.addEventListener('click', () => {
            const msg = (ch.reply && typeof ch.reply === 'string') ? ch.reply : (ch.label || 'OK');
            inputEl.value = msg;
            send();
          });
          panel.appendChild(b);
        });
        lastBubble.querySelector('.content').appendChild(panel);
      }
    }

  } catch (err) {
    thinkingEl.classList.remove('thinking');
    const msg = 'Error: ' + (err?.message || 'Failed to reach /api/chat');
    thinkingEl.textContent = msg; logApiToChat('CHAT exception', msg);
  }
}

/* ----------------------- Top Buttons ----------------------- */
function wireButtons() {
  const byId = (id) => document.getElementById(id);

  const btnLoadDefault = byId('btn-load-default');
  if (btnLoadDefault) {
    btnLoadDefault.addEventListener('click', async () => {
      try {
        const res = await loadGame({ modularBase: 'seed/' });
        setGame(res);
        ensureStatsScaffold(game.state);
        game.state.meta = game.state.meta || {};
        game.state.meta.season = CFG.START_SEASON;
        game.state.meta.timeline = CFG.START_TIMELINE;
        game.state.meta.last_completed_round = CFG.START_ROUND;
        sanityCheckAndRepair(game.state);
        announce('🌱 Fresh seed loaded from seed/.');
        saveLocal(game.state);
        announceStage(game.state);
        tryRenderStandingsTabs();
        updateSidebar(game.state);
      } catch (e) {
        console.error(e);
        announce('⚠️ Could not load seed/. Check seed/manifest.json.');
      }
    });
  }

  const btnImport = byId('btn-import');
  const fileImport = byId('file-import');
  if (btnImport && fileImport) {
    btnImport.addEventListener('click', () => fileImport.click());
    fileImport.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      try {
        const res = await loadGame({ bundleUrl: f });
        setGame(res);
        ensureStatsScaffold(game.state);
        sanityCheckAndRepair(game.state);
        announce('📦 Save imported.');
        saveLocal(game.state);
        announceStage(game.state);
        tryRenderStandingsTabs();
        updateSidebar(game.state);
      } catch (err) {
        console.error(err);
        announce('❌ Invalid or corrupted save file.');
      } finally { e.target.value = ''; }
    });
  }

  const btnExport = byId('btn-export');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      if (!game?.state) return announce('😵 No game state to export.');
      exportBundle(game.state);
      announce('💾 Save exported.');
    });
  }

  const btnSaveLocal = byId('btn-save-local');
  if (btnSaveLocal) {
    btnSaveLocal.addEventListener('click', () => {
      if (!game?.state) return announce('😵 No game state to save.');
      saveLocal(game.state);
      announce('📍 Save written to localStorage.');
    });
  }

  const btnClearLocal = byId('btn-clear-local');
  if (btnClearLocal) {
    btnClearLocal.addEventListener('click', () => {
      localStorage.removeItem('ccsf_state');
      announce('🗑️ Local save cleared.');
      tryRenderStandingsTabs();
      updateSidebar(null);
    });
  }
}

/* ----------------------- Boot ----------------------- */
window.addEventListener('DOMContentLoaded', async () => {
  // chat DOM refs
  chatEl   = document.getElementById('chat');
  inputEl  = document.getElementById('input');
  sendBtn  = document.getElementById('send');
  clearBtn = document.getElementById('clear');
  tpl      = document.getElementById('bubble');

  if (sendBtn) sendBtn.addEventListener('click', send);
  if (inputEl) addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  if (clearBtn) clearBtn.addEventListener('click', () => { history = []; localStorage.removeItem(STORAGE_KEY); chatEl.innerHTML = ''; restoreChat(); });

  restoreChat();
  wireButtons();
  injectStandingsTabs();
  injectRaceButton();
  injectSidebar();

  const cached = loadLocal();
  if (cached) {
    setGame({ manifest: { version: '2025.0.1', season: cached.meta.season || CFG.START_SEASON, timeline: cached.meta.timeline || CFG.START_TIMELINE }, state: cached });
    ensureStatsScaffold(game.state);
    sanityCheckAndRepair(game.state);
    announce('♻️ Resumed from local save.');
    announceStage(game.state);
    tryRenderStandingsTabs();
    updateSidebar(game.state);
    return;
  }

  try {
    const res = await bootGame({ defaultBundle: 'saves/slot1.ccsf.json', modularBase: 'seed/' });
    setGame(res);
    ensureStatsScaffold(game.state);
    // New game meta
    game.state.meta = game.state.meta || {};
    game.state.meta.season = CFG.START_SEASON;
    game.state.meta.timeline = CFG.START_TIMELINE;
    game.state.meta.last_completed_round = CFG.START_ROUND;

    sanityCheckAndRepair(game.state);
    announce('✅ Seed loaded successfully! The grid is ready — time to play.');
    saveLocal(game.state);
    announceStage(game.state);
    tryRenderStandingsTabs();
    updateSidebar(game.state);
  } catch (err) {
    console.error('BOOT ERROR:', err);
    announce('💥 Boot failed. Check seed/manifest.json and loader.js path.');
  }
});
