// spp.js — Chat chaos brain (auto-apply ops) + hybrid loader
// Make sure index.html uses: <script type="module" src="spp.js"></script>
import { bootGame, loadGame, exportBundle } from './loader.js';

/* ----------------------- Seed Snapshot (now with full car) ----------------------- */
function getSeedContext() {
  // prefer live state; fall back to cached export
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
    // ⬇️ full car object so GPT can reason about ALL attributes
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

/* ----------------------- Auto-apply ops from GPT ----------------------- */
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

  const getRef = (root, keys) => {
    let obj = root;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (obj == null || !(k in obj)) return [null, null];
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
    const [obj, key] = getRef(state, keys);
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

/* ----------------------- Chat (same UI as before) ----------------------- */
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
    // System prompt: STRICT JSON { narration, ops } and meme tone
    const seed = getSeedContext();
    const systemPrompt =
      'You are DS AI, the cynical meme-narrator strategist for an F1 management sim. ' +
      'Read game_state and when the player asks for a decision (rumours, fire, research, TD, penalties, upgrades), ' +
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

    const data = await res.json();
    let reply = data.reply;

    // Parse strict JSON (supports full JSON or JSON inside a code block/plain text)
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

    let outText = reply || 'No reply.';

    // Auto-apply ops + explicitly narrate DB changes
    if (payload && payload.ops && payload.ops._type === 'ccsf_ops_v1') {
      const resOps = applyOps(game.state, payload.ops);
      if (resOps.ok) {
        try { localStorage.setItem('ccsf_state', JSON.stringify(game.state)); } catch {}
        const dbLine = `🧾 Database updated: ${resOps.changed.join(', ')}`;
        outText = (payload.narration ? payload.narration + '\n\n' : '') + dbLine;
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
    thinkingEl.textContent = 'Error: ' + (err?.message || 'Failed to reach /api/chat');
  }
}

/* ----------------------- Top Buttons (unchanged) ----------------------- */
function wireButtons() {
  const byId = (id) => document.getElementById(id);

  const btnLoadDefault = byId('btn-load-default');
  if (btnLoadDefault) {
    btnLoadDefault.addEventListener('click', async () => {
      try {
        const res = await loadGame({ modularBase: 'seed/' });
        setGame(res);
        announce('🌱 Fresh seed loaded from seed/.');
        saveLocal(game.state);
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
        announce('📦 Save imported.');
        saveLocal(game.state);
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

  // wire chat
  if (sendBtn) sendBtn.addEventListener('click', send);
  if (inputEl) inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  if (clearBtn) clearBtn.addEventListener('click', () => { history = []; localStorage.removeItem(STORAGE_KEY); chatEl.innerHTML = ''; restoreChat(); });
  restoreChat();

  // wire top control buttons
  wireButtons();

  // boot game state (local → bundle → seed)
  const cached = loadLocal();
  if (cached) {
    setGame({
      manifest: { version: '2025.0.1', season: cached.meta.season || 2025, timeline: cached.meta.timeline || 'preseason' },
      state: cached
    });
    announce('♻️ Resumed from local save.');
    return;
  }

  try {
    const res = await bootGame({ defaultBundle: 'saves/slot1.ccsf.json', modularBase: 'seed/' });
    setGame(res);
    announce('✅ Seed loaded successfully! The grid is ready — time to play.');
    saveLocal(game.state);
  } catch (err) {
    console.error('BOOT ERROR:', err);
    announce('💥 Boot failed. Check seed/manifest.json and loader.js path.');
  }
});
