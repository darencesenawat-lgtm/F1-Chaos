// app.js — DS AI Chaos Brain: Live Tabs + One-click RACE + Robust Standings + iPad Debug Logs

import { bootGame, loadGame, exportBundle } from './loader.js';

/* ----------------------- Seed Snapshot (slim context for general Q&A) ----------------------- */
function getSeedContext() {
  const s = (typeof game?.state !== 'undefined') ? game.state
            : JSON.parse(localStorage.getItem('ccsf_state') || 'null');
  if (!s) return null;

  const teams = (s.teams || []).map(t => ({
    id: t.team_id,
    name: t.team_name,
    principal: t.team_principal,
    drivers: t.drivers,
    engineers: t.race_engineers,
    engine: t.engine_supplier,
    sponsors: (t.sponsors || []).slice(0, 5),
    finance: t.finance ? {
      balance_usd: Math.round(t.finance.balance_usd),
      budget_cap_remaining_usd: Math.round(t.finance.budget_cap_remaining_usd)
    } : undefined,
    car: t.car || undefined
  }));

  const drivers = (s.drivers || []).map(d => ({
    id: d.driver_id, name: d.name, team: d.team,
    age: d.age, rating: d.overall_rating, form: d.form
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

  const today = new Date();
  const next = (s.calendar || []).find(c => new Date(c.date) >= today) || (s.calendar || [])[0] || null;

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
    calendar, next_race: next ? { round: next.round, name: next.name, date: next.date, country: next.country } : null,
    rumours, development, stats
  };

  function pickAttrs(obj, keys) {
    if (!obj) return undefined;
    const out = {};
    for (const k of keys) if (k in obj) out[k] = obj[k];
    return Object.keys(out).length ? out : undefined;
  }
}

/* ----------------------- Minimal race context for GPT ----------------------- */
function buildRaceSliceForPrompt(s) {
  const today = new Date();
  const calendar = Array.isArray(s?.calendar) ? s.calendar : [];
  const next = calendar.find(c => new Date(c.date) >= today) || calendar[0] || null;
  const safeNext = next || { round: 1, name: 'Test Track', date: '2025-01-01', country: '—', attrs: {} };

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

  return {
    next_race: { round: safeNext.round, name: safeNext.name, date: safeNext.date, country: safeNext.country, attrs: safeNext.attrs },
    teams, drivers,
    tyres: s?.tyres || s?.tires || undefined,
    weather: s?.weather || undefined,
    recent_results: Array.isArray(s?.stats?.race_results) ? s.stats.race_results.slice(-3) : []
  };
}

/* ----------------------- Auto-apply ops (creates missing paths) ----------------------- */
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

/* ----------------------- Globals & helpers ----------------------- */
let game = null;

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

function saveLocal(state) { try { localStorage.setItem('ccsf_state', JSON.stringify(state)); } catch {} }
function loadLocal() {
  try {
    const raw = localStorage.getItem('ccsf_state');
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (!state?.meta?.season) return null;
    return state;
  } catch { return null; }
}
function setGame(newGame) { game = newGame; }
function ensureStatsScaffold(state) {
  if (!state) return;
  state.stats = state.stats || {};
  state.stats.race_results = state.stats.race_results || [];
}

/* ---- Inline debug to chat (iPad-friendly) ---- */
function logApiToChat(title, info) {
  try {
    const pretty = typeof info === 'string' ? info : JSON.stringify(info, null, 2);
    addMessage('assistant', `🔎 ${title}\n${pretty}`);
  } catch {
    addMessage('assistant', `🔎 ${title} (unprintable)`);
  }
}

/* ----------------------- Chat (same UI / endpoints) ----------------------- */
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
  if (history.length === 0) { addMessage('assistant', 'Hi! I am DS AI. Ask me anything.'); return; }
  history.forEach(m => addMessage(m.role, m.content, m.time));
}

/* ----------------------- One-click Race button ----------------------- */
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

async function runRaceSim() {
  if (!game?.state) return announce('😵 No game state to simulate.');
  ensureStatsScaffold(game.state);

  // log to chat
  const uMsg = { role:'user', content:'Simulate qualifying and race at the next event.', time: now() };
  history.push(uMsg);
  addMessage('user', uMsg.content, uMsg.time);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));

  addMessage('assistant', 'Thinking…', now());
  const thinkingEl = chatEl.lastElementChild.querySelector('.content');
  thinkingEl.classList.add('thinking');

  try {
    const stateNow = game.state;
    const raceSlice = buildRaceSliceForPrompt(stateNow);
    const slim = getSeedContext();

    const systemPrompt =
      'You are DS AI, the cynical meme-narrator strategist for an F1 management sim.\n' +
      'Always return STRICT JSON ONLY: { "narration": string, "ops": { "_type":"ccsf_ops_v1", "changes":[ ... ] } }.\n' +
      'Simulate QUALIFYING and the RACE for the NEXT EVENT using race_context pace, tyres, weather, and form.\n' +
      'WRITE RESULTS to /stats/race_results with a PUSH op. Append an object: ' +
      '{ "round": <number>, "name": "<track>", "finishers":[{"driver":"<name>","team":"<team>","position":1,"points":25}, ...] }.\n' +
      'If you compute updated standings, write arrays to /stats/driver_standings and /stats/constructor_standings.\n' +
      'Keep car attributes within 0–100 when modifying. If crucial data is missing, ask ONE short follow-up in "narration" and output empty ops.\n' +
      'Example OUTPUT (STRICT JSON):\n' +
      '{ "narration":"SC on lap 23 flipped it.", "ops":{"_type":"ccsf_ops_v1","changes":[{"op":"push","path":"/stats/race_results","value":{"round":7,"name":"Montreal","finishers":[{"driver":"A","team":"Alpha","position":1,"points":25}]}}]}}\n' +
      '\n' +
      'game_state_slim=' + JSON.stringify(slim) + '\n' +
      'race_context=' + JSON.stringify(raceSlice);

    const res = await fetch('api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role:'system', content: systemPrompt },
          { role:'user',   content: 'Simulate qualifying and the race for the next event NOW. Return STRICT JSON only as specified.' }
        ]
      })
    });

    // Log HTTP status and raw body (for iPad)
    const raw = await res.text();
    logApiToChat('RACE api/chat status', res.status + (res.ok ? ' OK' : ' ERROR'));
    logApiToChat('RACE api/chat body (first 1200 chars)', raw.slice(0, 1200));

    if (!res.ok) {
      thinkingEl.classList.remove('thinking');
      thinkingEl.textContent = `❌ Chat API HTTP ${res.status}. See debug message above.`;
      history.push({ role:'assistant', content: thinkingEl.textContent, time: now() });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
      return;
    }

    // Try parse JSON from raw
    let data = null;
    try { data = JSON.parse(raw); } catch {}

    let reply = (data && data.reply) ? data.reply : raw;

    // Extract JSON payload from reply (if string-wrapped)
    let payload = null;
    if (typeof reply === 'string') {
      const start = reply.indexOf('{');
      const end = reply.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        try { payload = JSON.parse(reply.slice(start, end + 1)); } catch {}
      }
    } else if (reply && typeof reply === 'object') {
      payload = reply;
    }

    let outText = typeof reply === 'string' ? reply : (payload?.narration || 'No reply.');

    if (payload && payload.ops && payload.ops._type === 'ccsf_ops_v1') {
      const resOps = applyOps(game.state, payload.ops);
      if (resOps.ok) {
        try { localStorage.setItem('ccsf_state', JSON.stringify(game.state)); } catch {}
        outText = (payload.narration ? payload.narration + '\n\n' : '') +
                  `🧾 Database updated: ${resOps.changed.join(', ')}`;
        tryRenderStandingsTabs();
      } else {
        outText = (payload.narration ? payload.narration + '\n\n' : '') +
                  '🤖 Model returned no actionable ops. Tip: ensure it uses {"op":"push","path":"/stats/race_results",...}.';
      }
    } else {
      outText = (payload?.narration ? payload.narration + '\n\n' : '') +
                '🤖 No ops object detected. The model must output STRICT JSON with {"ops":{"_type":"ccsf_ops_v1","changes":[...]}}.';
    }

    thinkingEl.classList.remove('thinking');
    thinkingEl.textContent = outText;

    history.push({ role:'assistant', content: outText, time: now() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (err) {
    thinkingEl.classList.remove('thinking');
    const msg = 'Error: ' + (err?.message || 'Failed to reach /api/chat');
    thinkingEl.textContent = msg;
    logApiToChat('RACE exception', msg);
  }
}

/* ----------------------- Chat send (general Q&A) ----------------------- */
async function send() {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';

  const msg = { role: 'user', content: text, time: now() };
  history.push(msg);
  addMessage('user', text, msg.time);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));

  addMessage('assistant', 'Thinking…', now());
  const thinkingEl = chatEl.lastElementChild.querySelector('.content');
  thinkingEl.classList.add('thinking');

  try {
    const seed = getSeedContext();
    const systemPrompt =
      'You are DS AI, the cynical meme-narrator strategist for an F1 management sim. ' +
      'Read game_state and when the player asks for a decision (rumours, fire, research, TD, penalties, upgrades, race sim), ' +
      'RETURN STRICT JSON ONLY with two fields: narration (string) and ops (object). ' +
      'Format:\n' +
      '{ "narration": "<spicy paddock gossip>", "ops": { "_type": "ccsf_ops_v1", "changes": [ { "op":"inc|set|push", "path": "/teams/<team_id>/car/tyre_degradation", "value": -2 } ] } }\n' +
      'Rules: use ONLY existing fields; keep numbers sane (0–100 for car attrs); realistic costs/durations; if unsure, ask a one-line follow-up.' +
      (seed ? '\n\ngame_state=' + JSON.stringify(seed) : '\n\n(game_state unavailable)');

    const res = await fetch('api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role:'system', content: systemPrompt },
          ...history.map(({role, content}) => ({role, content}))
        ]
      })
    });

    // iPad-friendly logs
    const raw = await res.text();
    logApiToChat('CHAT api/chat status', res.status + (res.ok ? ' OK' : ' ERROR'));
    logApiToChat('CHAT api/chat body (first 1200 chars)', raw.slice(0, 1200));

    if (!res.ok) {
      thinkingEl.classList.remove('thinking');
      thinkingEl.textContent = `❌ Chat API HTTP ${res.status}. See debug message above.`;
      history.push({ role:'assistant', content: thinkingEl.textContent, time: now() });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
      return;
    }

    let data = null;
    try { data = JSON.parse(raw); } catch {}
    let reply = (data && data.reply) ? data.reply : raw;

    let payload = null;
    if (typeof reply === 'string') {
      const start = reply.indexOf('{');
      const end = reply.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        try { payload = JSON.parse(reply.slice(start, end + 1)); } catch {}
      }
    } else if (reply && typeof reply === 'object') {
      payload = reply;
    }

    let outText = typeof reply === 'string' ? reply : (payload?.narration || 'No reply.');
    if (payload && payload.ops && payload.ops._type === 'ccsf_ops_v1') {
      const resOps = applyOps(game.state, payload.ops);
      if (resOps.ok) {
        try { localStorage.setItem('ccsf_state', JSON.stringify(game.state)); } catch {}
        outText = (payload.narration ? payload.narration + '\n\n' : '') +
                  `🧾 Database updated: ${resOps.changed.join(', ')}`;
        tryRenderStandingsTabs();
      } else {
        outText = payload.narration || outText;
      }
    }

    thinkingEl.classList.remove('thinking');
    thinkingEl.textContent = outText;

    history.push({ role:'assistant', content: outText, time: now() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (err) {
    thinkingEl.classList.remove('thinking');
    const msg = 'Error: ' + (err?.message || 'Failed to reach /api/chat');
    thinkingEl.textContent = msg;
    logApiToChat('CHAT exception', msg);
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
        announce('🌱 Fresh seed loaded from seed/.');
        saveLocal(game.state);
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
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const res = await loadGame({ bundleUrl: f });
        setGame(res);
        ensureStatsScaffold(game.state);
        announce('📦 Save imported.');
        saveLocal(game.state);
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

/* ----------------------- Standings Tabs (no HTML changes) ----------------------- */
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

/* ---------- STANDINGS: driver + team (robust) ---------- */
function getDriverStandings(s) {
  const direct =
    s?.stats?.driver_standings ||
    s?.stats?.drivers_standings ||
    s?.stats?.standings?.drivers ||
    [];

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
  const direct =
    s?.stats?.constructor_standings ||
    s?.stats?.team_standings ||
    s?.stats?.standings?.teams ||
    [];

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

/* ---------- Recompute from results (tolerant to shapes) ---------- */
function computeStandingsFromResults(s) {
  const results = Array.isArray(s?.stats?.race_results) ? s.stats.race_results : [];
  const ptsMap = normalizePointsSystem(s?.regulations?.points_system);

  const drv = new Map();
  const tm  = new Map();

  // roster lookups
  const roster = Array.isArray(s?.drivers) ? s.drivers : [];
  const driverTeamById = new Map(roster.map(d => [String(d.driver_id ?? d.name), d.team || d.constructor || '—']));
  const driverIdByName = new Map(roster.map(d => [String(d.name), String(d.driver_id ?? d.name)]));

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
      const team = entry.team || entry.constructor ||
        driverTeamById.get(String(entry.driver_id ?? driverIdByName.get(String(entry.name)) ?? key)) || '—';

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
      const pretty = roster.find(d =>
        String(d.driver_id) === String(r.driver) || String(d.name) === String(r.driver)
      );
      return { ...r, driver: pretty?.name || r.driver, team: pretty?.team || r.team };
    })
    .sort((a,b) => (b.points - a.points) || ((b.wins||0) - (a.wins||0)));

  const teams   = [...tm.values()]
    .sort((a,b) => (b.points - a.points) || ((b.wins||0) - (a.wins||0)));

  return { drivers, teams };
}

/* ---------- points system can be array OR object ---------- */
function normalizePointsSystem(ps) {
  // Default F1 top 10
  const fallback = { 1:25, 2:18, 3:15, 4:12, 5:10, 6:8, 7:6, 8:4, 9:2, 10:1 };
  if (!ps) return fallback;

  if (Array.isArray(ps)) {
    const obj = {};
    for (let i = 0; i < ps.length; i++) obj[i+1] = Number(ps[i] || 0); // index 0 → P1
    return Object.keys(obj).length ? obj : fallback;
  }

  if (typeof ps === 'object') {
    const obj = {};
    for (const k of Object.keys(ps)) obj[Number(k)] = Number(ps[k] || 0);
    // handle keys like "P1", "p2", etc.
    for (const k of Object.keys(ps)) {
      const m = /^p(\d+)$/i.exec(k);
      if (m) obj[Number(m[1])] = Number(ps[k] || 0);
    }
    return Object.keys(obj).length ? obj : fallback;
  }

  return fallback;
}

/* ---------- tiny table helpers ---------- */
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

/* ----------------------- Boot ----------------------- */
window.addEventListener('DOMContentLoaded', async () => {
  // chat DOM refs (your original IDs)
  chatEl   = document.getElementById('chat');
  inputEl  = document.getElementById('input');
  sendBtn  = document.getElementById('send');
  clearBtn = document.getElementById('clear');
  tpl      = document.getElementById('bubble');

  // wire chat
  if (sendBtn) sendBtn.addEventListener('click', send);
  if (inputEl) addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  if (clearBtn) clearBtn.addEventListener('click', () => { history = []; localStorage.removeItem(STORAGE_KEY); chatEl.innerHTML = ''; restoreChat(); });
  restoreChat();

  // wire top control buttons
  wireButtons();

  // inject UI
  injectStandingsTabs();
  injectRaceButton();

  // boot game state (local → bundle → seed)
  const cached = loadLocal();
  if (cached) {
    setGame({
      manifest: { version: '2025.0.1', season: cached.meta.season || 2025, timeline: cached.meta.timeline || 'preseason' },
      state: cached
    });
    ensureStatsScaffold(game.state);
    announce('♻️ Resumed from local save.');
    tryRenderStandingsTabs();
    return;
  }

  try {
    const res = await bootGame({ defaultBundle: 'saves/slot1.ccsf.json', modularBase: 'seed/' });
    setGame(res);
    ensureStatsScaffold(game.state);
    announce('✅ Seed loaded successfully! The grid is ready — time to play.');
    saveLocal(game.state);
    tryRenderStandingsTabs();
  } catch (err) {
    console.error('BOOT ERROR:', err);
    announce('💥 Boot failed. Check seed/manifest.json and loader.js path.');
  }
});
