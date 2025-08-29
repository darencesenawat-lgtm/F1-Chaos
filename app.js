// app.js — old Chat UI + API restored, plus hybrid game loader + buttons
// Make sure index.html uses: <script type="module" src="app.js"></script>

import { bootGame, loadGame, exportBundle } from './loader.js';

function getSeedContext() {
  // prefer in-memory; fall back to localStorage if not yet booted
  const s = (typeof game?.state !== 'undefined') ? game.state
            : JSON.parse(localStorage.getItem('ccsf_state') || 'null');
  if (!s) return null;

  const teams = (s.teams || []).map(t => ({
    id: t.team_id, name: t.team_name, drivers: t.drivers
  }));
  const drivers = (s.drivers || []).map(d => ({
    id: d.driver_id, name: d.name, team: d.team, rating: d.overall_rating
  }));

  // find the next race (or first)
  const today = new Date();
  const next = (s.calendar || []).find(c => new Date(c.date) >= today) || (s.calendar || [])[0] || null;

  return {
    season: s.meta?.season, timeline: s.meta?.timeline,
    selected_team: s.meta?.selected_team || null,
    teams, drivers,
    next_race: next ? { round: next.round, name: next.name, date: next.date, country: next.country } : null
  };
}


let game = null;

// ---------- announce fallback ----------
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

// ---------- local save helpers ----------
function saveLocal(state) {
  try { localStorage.setItem('ccsf_state', JSON.stringify(state)); } catch {}
}
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

// ========== CHAT (restored from your old app.js) ==========
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
try {
  // build seed-aware system prompt
  const seed = getSeedContext();
  const systemPrompt =
    'You are DS AI, a concise race strategist assistant for an F1 management sim. ' +
    'Use the provided game_state JSON to ground your answers in the current world (teams, drivers, next race). ' +
    'If data is missing, ask concise follow-ups.' +
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
  const reply = data.reply;
  ...
    const data = await res.json();
    const reply = data.reply;

    thinkingEl.classList.remove('thinking');
    if (data.error) {
      thinkingEl.textContent = 'Error: ' + data.error;
    } else {
      thinkingEl.textContent = reply || 'No reply.';
      history.push({ role:'assistant', content: reply || 'No reply.', time: now() });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    }
  } catch (err) {
    thinkingEl.classList.remove('thinking');
    thinkingEl.textContent = 'Error: ' + (err?.message || 'Failed to reach /api/chat');
  }
}

// ========== BUTTONS (your existing IDs) ==========
function wireButtons() {
  const byId = (id) => document.getElementById(id);

  const btnLoadDefault = byId('btn-load-default');
  if (btnLoadDefault) {
    btnLoadDefault.addEventListener('click', async () => {
      try {
        const res = await loadGame({ modularBase: 'seed/' }); // relative paths
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

// ========== BOOT ==========
window.addEventListener('DOMContentLoaded', async () => {
  // 1) chat DOM refs (same IDs as your old file)
  chatEl   = document.getElementById('chat');
  inputEl  = document.getElementById('input');
  sendBtn  = document.getElementById('send');
  clearBtn = document.getElementById('clear');
  tpl      = document.getElementById('bubble');

  // 2) wire chat
  if (sendBtn) sendBtn.addEventListener('click', send);
  if (inputEl) inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  if (clearBtn) clearBtn.addEventListener('click', () => { history = []; localStorage.removeItem(STORAGE_KEY); chatEl.innerHTML = ''; restoreChat(); });
  restoreChat();

  // 3) wire top control buttons
  wireButtons();

  // 4) boot game state (local → bundle → seed)
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
    // As a fallback (don’t block chat even if seed fails)
    announce('💥 Boot failed. Check seed/manifest.json and loader.js path.');
  }
});
