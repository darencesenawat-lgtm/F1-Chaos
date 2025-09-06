// app.js — DS AI Chat-First Build with Contract Guards
// Friendly chat by default, strict ops only when needed. Round-based season flow.
// No date shenanigans. Constructors fixed via roster-normalized teams.

import { bootGame, loadGame, exportBundle } from './loader.js';

/* ────────────────────────────────────────────────────────────────────────────
   🔒 GAME CONTRACT (Do Not Break)
   1) New game must start at: season=2025, timeline='preseason', last_completed_round=0
   2) Next race chosen by round > last_completed_round (ignore real-world dates)
   3) Chat is FRIENDLY by default; OPS mode only when intent needs state changes
   4) After any OPS that modify results, recompute & store driver/constructor standings
   5) Team names in standings must map to roster teams (normalize/force mapping)
   6) On boot/resume, announce current stage: `${season} — ${timeline} (last_completed_round=N)`
   7) Debug logs OFF by default
   If any fail, fail loudly in UI and auto-repair where possible.
   ──────────────────────────────────────────────────────────────────────────── */

const CFG = {
  DEBUG: false,
  FRIENDLY_CHAT_DEFAULT: true,
  REQUIRE_STRICT_JSON_IN_OPS: true,
  START_SEASON: 2025,
  START_TIMELINE: 'preseason',
  START_ROUND: 0,
  FORCE_ROSTER_TEAMS: true,   // standings use roster mapping
};

/* ----------------------- Globals & helpers ----------------------- */
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

/* ---- Debug to chat (iPad-friendly) ---- */
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

  const pickAttrs = (obj, keys) => {
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
    attrs: pickAttrs(p.attrs, ['leadership','politics','media','dev_focus','risk'])
  }));

  const engineers = (s.engineers || []).map(e => ({
    id: e.re_id, name: e.name, team: e.team, driver: e.driver,
    attrs: pickAttrs(e.attrs, ['tyre_management','racecraft','strategy','comms'])
  }));

  const calendar = (s.calendar || []).map(c => ({
    round: c.round, name: c.name, date: c.date, country: c.country,
    attrs: pickAttrs(c.attrs, ['downforce','tyre_wear','brake_severity','power_sensitivity'])
  }));

  const rumours = (s.rumours || [])
    .filter(r => r.status !== 'debunked')
    .slice(0, 12)
    .map(r => ({ id: r.rumour_id, category: r.category, status: r.status, impact: r.impact, content: r.content }));

  const regs = s.regulations ? pickAttrs(s.regulations, [
    'budget_cap_usd','wind_tunnel_hours_base','points_system','penalties_policy'
  ]) : undefined;

  const sponsors = s.sponsors ? { count: (s.sponsors.master || []).length } : undefined;
  const development = s.development ? { modules: Object.keys(s.development || {}).length } : undefined;
  const stats = s.stats ? {
    have_results: !!s.stats.race_results,
    have_standings: !!s.stats.driver_standings
  } : undefined;

  return {
    meta: { season: s.meta?.season, timeline: s.meta?.timeline, selected_team: s.meta?.selected_team || null },
    regs, sponsors,
    teams, drivers, principals, engineers,
    calendar, next_race: null, // we compute next race separately
    rumours, development, stats
  };
}

/* ----------------------- Round-based next race (ignore dates) ----------------------- */
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

  const drivers = (s?.drivers || []).map(d => ({
    name: d.name, team: d.team,
    rating: d.overall_rating, form: d.form,
    pace_mod: d.pace_mod, quali_mod: d.quali_mod, wet_mod: d.wet_mod
  }));

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

/* ----------------------- Intent: when do we need ops? ----------------------- */
function isOpsIntent(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return /\b(sim|simulate|race|quali|qualifying|grand prix|gp|upgrade|develop|wind tunnel|research|engine|contract|sign|hire|fire|penalty|penalties|td|technical directive|standings|apply|push|ops)\b/.test(t)
       || t.startsWith('/ops')
       || t.endsWith('!ops');
}

/* ----------------------- Validate payload from model ----------------------- */
function validateOpsPayload(payload) {
  if (!payload || typeof payload !== 'object') return { ok:false, reason:'no-payload' };
  if (!('narration' in payload)) return { ok:false, reason:'no-narration' };
  const ops = payload.ops;
  if (!ops) return { ok:true, ops: null }; // narration-only is fine in friendly mode
  if (ops._type !== 'ccsf_ops_v1' || !Array.isArray(ops.changes)) {
    return { ok:false, reason:'bad-ops-shape' };
  }
  return { ok:true, ops };
}

/* ----------------------- Ops applier ----------------------- */
// Supports { op: "set"|"inc"|"push", path: "/a/b/c" or "a.b.c", value: any }
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

/* ----------------------- Standings recompute (with roster-normalized teams) ----------------------- */
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

  const drv = new Map();
  const tm  = new Map();

  const roster = Array.isArray(s?.drivers) ? s.drivers : [];
  const rosterTeams = Array.isArray(s?.teams) ? s.teams.map(t => t.team_name || t.name) : [];
  const teamByDriverName = new Map(roster.map(d => [String(d.name), d.team || d.constructor || '—']));
  const teamByDriverId   = new Map(roster.map(d => [String(d.driver_id ?? d.name), d.team || d.constructor || '—']));

  const tokenize = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(' ').filter(Boolean);
  const normTeam = (name) => {
    if (!name) return '—';
    // exact match first
    for (const t of rosterTeams) if (String(t).toLowerCase() === String(name).toLowerCase()) return t;
    // fuzzy token overlap
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
      drow.points += pts;
      if (pos === 1) drow.wins += 1;
      if (pos <= 3) drow.podiums += 1;
      drow.team = team;
      drv.set(key, drow);

      const trow = tm.get(team) || { team, points:0, wins:0, podiums:0 };
      trow.points += pts;
      if (pos === 1) trow.wins += 1;
      if (pos <= 3) trow.podiums += 1;
      tm.set(team, trow);
    });
  }

  const drivers = [...drv.values()]
    .map(r => {
      const pretty = roster.find(d => String(d.driver_id) === String(r.driver) || String(d.name) === String(r.driver));
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
  } catch (e) {
    console.error('standings recompute failed', e);
    return false;
  }
}

/* ----------------------- After ops succeed: advance + recompute + announce ----------------------- */
function onOpsApplied(state) {
  // advance pointer
  const rr = Array.isArray(state?.stats?.race_results) ? state.stats.race_results : [];
  const latestRound = rr.length ? Number(rr[rr.length - 1]?.round || 0) : 0;
  state.meta = state.meta || {};
  if (latestRound > Number(state.meta.last_completed_round || 0)) {
    state.meta.last_completed_round = latestRound;
    if (state.meta.timeline === 'preseason' && latestRound > 0) state.meta.timeline = 'inseason';
  }
  // recompute standings
  recomputeAndStoreStandings(state);
  // persist + UI refresh
  try { localStorage.setItem('ccsf_state', JSON.stringify(state)); } catch {}
  tryRenderStandingsTabs();
  announceStage(state);
}

/* ----------------------- Sanity check & repair on boot/resume ----------------------- */
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
  const root = document.getElementById('ccsf_tabs');
  if (!root) return;
  const active = root.dataset.active || 'drivers';
  const panel = root.querySelector('#ccsf_panel');
  if (!panel) return;
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
    const th = document.createElement('th');
    th.textContent = h;
    th.style.cssText = 'text-align:left; padding:6px 8px; border-bottom:1px solid #2a2a2a; position:sticky; top:0; background:#111';
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    r.forEach((cell,i) => {
      const td = document.createElement('td');
      td.textContent = (cell ?? '').toString();
      td.style.cssText = 'padding:6px 8px; border-bottom:1px dashed #1f1f1f;';
      if (i === 0) td.style.color = '#aaa';
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
  box.appendChild(h);
  box.appendChild(tbl);
  return box;
}
function buildDriversTable(s) {
  const drivers = (s.drivers || []).map(d => ({
    name: d.name, team: d.team, age: d.age, rating: d.overall_rating, form: d.form
  }));
  const tbl = mkTable(['#','Driver','Team','Age','Rating','Form'],
    drivers
      .sort((a,b) => (b.rating ?? 0) - (a.rating ?? 0))
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
    return direct
      .map(x => ({
        driver: x.driver || x.name || x.driver_name || x.id || x.driver_id || '—',
        team: x.team || x.constructor || x.squad || '—',
        points: Number(x.points ?? x.pts ?? 0),
        wins: Number(x.wins ?? 0),
        podiums: Number(x.podiums ?? x.pods ?? 0),
      }))
      .sort((a,b) => (b.points - a.points) || ((b.wins||0) - (a.wins||0)));
  }
  return computeStandingsFromResults(s).drivers;
}
function getTeamStandings(s) {
  const direct = s?.stats?.constructor_standings || s?.stats?.team_standings || s?.stats?.standings?.teams || [];
  if (Array.isArray(direct) && direct.length) {
    return direct
      .map(x => ({
        team: x.team || x.name || x.constructor || '—',
        points: Number(x.points ?? x.pts ?? 0),
        wins: Number(x.wins ?? 0),
        podiums: Number(x.podiums ?? x.pods ?? 0),
      }))
      .sort((a,b) => (b.points - a.points) || ((b.wins||0) - (a.wins||0)));
  }
  return computeStandingsFromResults(s).teams;
}

/* ----------------------- SIDEBAR Dashboard ----------------------- */
function injectSidebar() {
  if (document.getElementById('dashboard-sidebar')) return;

  const sidebar = document.createElement('div');
  sidebar.id = 'dashboard-sidebar';
  sidebar.style.cssText = `
    position:fixed;
    top:0;
    left:0;
    width:220px;
    height:100vh;
    background:#17171b;
    color:#eaeaea;
    border-right:1px solid #23232b;
    box-shadow:2px 0 18px rgba(0,0,0,.08);
    z-index:9997;
    padding:24px 16px 16px 14px;
    font:15px/1.5 system-ui;
    display:flex;
    flex-direction:column;
    gap:24px;
  `;

  sidebar.innerHTML = `
    <div style="font-weight:700;font-size:1.3em;margin-bottom:10px;letter-spacing:.5px;">
      🏎️ F1 Chaos Dashboard
    </div>
    <nav style="display:flex;flex-direction:column;gap:10px;">
      <button id="sb-drivers" style="background:none;border:none;color:#eaeaea;text-align:left;cursor:pointer;font:inherit;padding:4px 0;">Drivers</button>
      <button id="sb-teams" style="background:none;border:none;color:#eaeaea;text-align:left;cursor:pointer;font:inherit;padding:4px 0;">Teams</button>
      <button id="sb-standings" style="background:none;border:none;color:#eaeaea;text-align:left;cursor:pointer;font:inherit;padding:4px 0;">Standings</button>
      <button id="sb-calendar" style="background:none;border:none;color:#eaeaea;text-align:left;cursor:pointer;font:inherit;padding:4px 0;">Calendar</button>
    </nav>
    <div id="sb-season-info" style="margin-top:18px;font-size:.98em;color:#b0b0b7;">
      <!-- Season info will be injected here -->
    </div>
  `;

  document.body.appendChild(sidebar);

  // Example: update season info when game state is available
  function updateSeasonInfo() {
    const el = document.getElementById('sb-season-info');
    if (!el || !window.game || !game.state) return;
    const m = game.state.meta || {};
    el.innerHTML = `
      <div><strong>Season:</strong> ${m.season ?? "?"}</div>
      <div><strong>Timeline:</strong> ${m.timeline ?? "?"}</div>
      <div><strong>Last Round:</strong> ${m.last_completed_round ?? "0"}</div>
    `;
  }

  updateSeasonInfo();
  // Update info when announcing stage
  const origAnnounceStage = window.announceStage;
  window.announceStage = function(state) {
    origAnnounceStage(state);
    updateSeasonInfo();
  };

  // Example navigation: clicking sidebar buttons could show relevant tabs
  document.getElementById('sb-drivers').onclick = () => {
    injectStandingsTabs();
    document.querySelector('#ccsf_tabs [data-id="drivers"]')?.click();
  };
  document.getElementById('sb-teams').onclick = () => {
    injectStandingsTabs();
    document.querySelector('#ccsf_tabs [data-id="tm_std"]')?.click();
  };
  document.getElementById('sb-standings').onclick = () => {
    injectStandingsTabs();
    document.querySelector('#ccsf_tabs [data-id="drv_std"]')?.click();
  };
  document.getElementById('sb-calendar').onclick = () => {
    announce('🗓️ Calendar view coming soon!');
    // You could implement a calendar panel here if you want
  };

/* ----------------------- RACE button ----------------------- */
function injectRaceButton() {
  if (document.getElementById('race-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'race-btn';
  btn.textContent = 'RACE';
  btn.title = 'Simulate next race (quali + GP)';
  btn.style.cssText = `
    position:fixed; left:12px; bottom:12px; z-index:9999;
    padding:10px 14px; border-radius:10px; border:1px solid #333; cursor:pointer;
    font:700 14px/1 system-ui; letter-spacing:.5px;
    background:#c1121f; color:#fff; box-shadow:0 3px 14px rgba(0,0,0,.35)
  `;
  btn.addEventListener('click', runRaceSim);
  document.body.appendChild(btn);
}

/* ----------------------- RACE flow ----------------------- */
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

    // Guards: roster+teams+points info
    const rosterDrivers = (stateNow?.drivers || []).map(d => d.name).filter(Boolean);
    const rosterTeams   = (stateNow?.teams || []).map(t => t.team_name || t.name).filter(Boolean);
    const ptsObj = (() => {
      const ps = stateNow?.regulations?.points_system;
      if (Array.isArray(ps)) return Object.fromEntries(ps.map((v,i)=>[i+1, Number(v||0)]));
      if (ps && typeof ps === 'object') {
        const o = {};
        Object.keys(ps).forEach(k => { const m = /^p?(\d+)$/i.exec(k); if (m) o[Number(m[1])] = Number(ps[k]||0); });
        return o;
      }
      return {1:25,2:18,3:15,4:12,5:10,6:8,7:6,8:4,9:2,10:1};
    })();

    const nxt = raceSlice.next_race;
    const roundHint = `Next race is Round ${nxt.round}: ${nxt.name}. Use this exact round number and name.`;

    const systemPrompt =
      'You are DS AI, the cynical meme-narrator strategist for an F1 management sim.\n' +
      'Return STRICT JSON ONLY: { "narration": string, "ops": { "_type":"ccsf_ops_v1", "changes":[ ... ] } }.\n' +
      'Narration: 2–4 short sentences, witty/cynical paddock vibe. No code blocks.\n' +
      'You MUST ONLY use these names. If a name is missing, replace with the closest roster driver.\n' +
      'Allowed drivers=' + JSON.stringify(rosterDrivers) + '\n' +
      'Allowed teams=' + JSON.stringify(rosterTeams) + '\n' +
      'Points per position (1-based)=' + JSON.stringify(ptsObj) + '\n' +
      roundHint + '\n' +
      'Simulate QUALIFYING + RACE for the NEXT EVENT using race_context. ' +
      'WRITE a PUSH to /stats/race_results with: { "round": <num>, "name": "<track>", "finishers":[{"driver":"<roster>","team":"<team>","position":1,"points":<from table>}, ...] }.\n' +
      'Keep car attrs 0–100. If crucial data is missing, ask ONE short follow-up in "narration" and set ops empty.\n' +
      'Example (no code fences): ' +
      '{ "narration":"SC on lap 23 flipped it.", "ops":{"_type":"ccsf_ops_v1","changes":[{"op":"push","path":"/stats/race_results","value":{"round":1,"name":"Example","finishers":[{"driver":"' +
      (rosterDrivers[0] || 'Driver A') + '","team":"' + (rosterTeams[0] || 'Team A') + '","position":1,"points":' + (ptsObj[1]||25) + '}]}}]}}' +
      '\n' +
      'game_state_slim=' + JSON.stringify(slim) + '\n' +
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
    logApiToChat('RACE api/chat body (first 1200 chars)', raw.slice(0, 1200));
    if (!res.ok) { thinkingEl.classList.remove('thinking'); thinkingEl.textContent = `❌ Chat API HTTP ${res.status}.`; return; }

    // accept both {reply:"<json>"} and raw json
    let data = null; try { data = JSON.parse(raw); } catch {}
    let reply = (data && data.reply) ? data.reply : raw;

    // Extract JSON payload
    let payload = null;
    if (typeof reply === 'string') {
      const start = reply.indexOf('{'); const end = reply.lastIndexOf('}');
      if (start !== -1 && end !== -1) { try { payload = JSON.parse(reply.slice(start, end + 1)); } catch {} }
    } else if (reply && typeof reply === 'object') { payload = reply; }

    const check = validateOpsPayload(payload);
    let outText = cleanNarration(payload?.narration || 'OK');

    if (!check.ok) {
      thinkingEl.classList.remove('thinking');
      thinkingEl.textContent = outText || `🤖 Malformed result (${check.reason}).`;
      history.push({ role:'assistant', content: thinkingEl.textContent, time: now() });
      return;
    }

    if (check.ops) {
      const resOps = applyOps(game.state, check.ops);
      if (resOps.ok) {
        onOpsApplied(game.state);
        outText = (outText || 'Race processed.') + `\n\n🧾 Database updated: ${resOps.changed.join(', ')}`;
      } else {
        outText = (outText || 'No actionable ops.');
      }
    } else {
      outText = outText || 'No structured result.';
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

/* ----------------------- General chat (dual-mode: friendly by default) ----------------------- */
async function send() {
  const text = inputEl.value.trim(); if (!text) return; inputEl.value = '';
  const msg = { role: 'user', content: text, time: now() };
  history.push(msg); addMessage('user', text, msg.time);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  addMessage('assistant', 'Thinking…', now());
  const thinkingEl = chatEl.lastElementChild.querySelector('.content'); thinkingEl.classList.add('thinking');

  const opsMode = isOpsIntent(text);

  try {
    const seed = getSeedContext();
    const systemPrompt = opsMode
      ? (
          'You are DS AI, the cynical meme-narrator strategist for an F1 management sim.\n' +
          'Return STRICT JSON ONLY: { "narration": string, "ops": { "_type": "ccsf_ops_v1", "changes": [ ... ] } }.\n' +
          'Rules: use ONLY existing fields; car attrs 0–100; realistic costs/durations; if unsure, ask ONE short follow-up in "narration" and set ops empty.' +
          (seed ? '\n\ngame_state=' + JSON.stringify(seed) : '\n\n(game_state unavailable)')
        )
      : (
          'You are DS AI, a cynical meme-y F1 team strategist. Reply as natural text only, 1–4 short sentences. ' +
          'No code, no JSON, no markdown fences. Be witty but clear.'
        );

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
    logApiToChat(opsMode ? 'CHAT(ops) status' : 'CHAT status', res.status + (res.ok?' OK':' ERROR'));
    logApiToChat(opsMode ? 'CHAT(ops) body' : 'CHAT body', raw.slice(0, 1200));
    if (!res.ok) {
      thinkingEl.classList.remove('thinking'); thinkingEl.textContent = `❌ Chat API HTTP ${res.status}.`;
      history.push({ role:'assistant', content: thinkingEl.textContent, time: now() }); return;
    }

    if (!opsMode) {
      const data = (() => { try { return JSON.parse(raw); } catch { return null; } })();
      const reply = (data && data.reply) ? data.reply : raw;
      const clean = cleanNarration(String(reply));
      thinkingEl.classList.remove('thinking'); thinkingEl.textContent = clean || '…';
      history.push({ role:'assistant', content: clean, time: now() }); return;
    }

    // ops mode
    let data = null; try { data = JSON.parse(raw); } catch {}
    let reply = (data && data.reply) ? data.reply : raw;
    let payload = null;
    if (typeof reply === 'string') {
      const start = reply.indexOf('{'); const end = reply.lastIndexOf('}');
      if (start !== -1 && end !== -1) { try { payload = JSON.parse(reply.slice(start, end + 1)); } catch {} }
    } else if (reply && typeof reply === 'object') { payload = reply; }

    const check = validateOpsPayload(payload);
    let outText = cleanNarration(payload?.narration || 'Done.');

    if (!check.ok) {
      thinkingEl.classList.remove('thinking'); thinkingEl.textContent = outText || `🤖 Malformed result (${check.reason}).`;
      history.push({ role:'assistant', content: thinkingEl.textContent, time: now() }); return;
    }

    if (check.ops) {
      const resOps = applyOps(game.state, check.ops);
      if (resOps.ok) {
        onOpsApplied(game.state);
        outText = (outText || 'OK') + `\n\n🧾 Database updated: ${resOps.changed.join(', ')}`;
      } else {
        outText = outText || 'No actionable ops.';
      }
    } else {
      outText = outText || 'No structured result.';
    }

    thinkingEl.classList.remove('thinking'); thinkingEl.textContent = outText;
    history.push({ role:'assistant', content: outText, time: now() });
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
        // Force new-game meta per contract
        game.state.meta = game.state.meta || {};
        game.state.meta.season = CFG.START_SEASON;
        game.state.meta.timeline = CFG.START_TIMELINE;
        game.state.meta.last_completed_round = CFG.START_ROUND;

        sanityCheckAndRepair(game.state);
        announce('🌱 Fresh seed loaded from seed/.');
        saveLocal(game.state);
        announceStage(game.state);
        tryRenderStandingsTabs();
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
    });
  }
}

/* ----------------------- Boot ----------------------- */
window.addEventListener('DOMContentLoaded', async () => {
  // chat DOM refs (your original IDs)
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
    return;
  }

  try {
    const res = await bootGame({ defaultBundle: 'saves/slot1.ccsf.json', modularBase: 'seed/' });
    setGame(res);
    ensureStatsScaffold(game.state);
    // New game: force contract meta
    game.state.meta = game.state.meta || {};
    game.state.meta.season = CFG.START_SEASON;
    game.state.meta.timeline = CFG.START_TIMELINE;
    game.state.meta.last_completed_round = CFG.START_ROUND;

    sanityCheckAndRepair(game.state);
    announce('✅ Seed loaded successfully! The grid is ready — time to play.');
    saveLocal(game.state);
    announceStage(game.state);
    tryRenderStandingsTabs();
  } catch (err) {
    console.error('BOOT ERROR:', err);
    announce('💥 Boot failed. Check seed/manifest.json and loader.js path.');
  }
});
