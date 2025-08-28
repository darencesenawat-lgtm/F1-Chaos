// app.js — module-safe boot + UI wiring (chat + buttons)
// Works with <script type="module" src="app.js"></script>

import { bootGame, loadGame, exportBundle } from './loader.js';

let game = null;

// ---------- safe announce fallback (in case your old ui.js isn't global) ----------
if (typeof window.announce !== 'function') {
  window.announce = (msg) => {
    console.log('[ANNOUNCE]', msg);
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.style.cssText = 'position:fixed;left:12px;bottom:12px;background:#222;color:#fff;padding:10px 12px;border-radius:8px;z-index:9999;max-width:60ch';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = 'block';
    setTimeout(() => (t.style.display = 'none'), 2500);
  };
}

// ---------- state hook you can customize ----------
function setGame(newGame) {
  game = newGame;
  // TODO: refresh your UI here from game.state (render lists/tables etc.)
  // For now just log:
  console.info('Game state set:', game);
}

// ---------- Chat UI wiring (no globals needed) ----------
function wireChatUI() {
  // Try common IDs — adjust if yours differ
  const chatForm   = document.getElementById('chat-form');
  const chatInput  = document.getElementById('chat-input') || document.querySelector('input[name="chat"]');
  const chatSend   = document.getElementById('chat-send')  || document.querySelector('[data-action="send"]');

  const doSend = (e) => {
    if (e) e.preventDefault();
    const text = (chatInput?.value || '').trim();
    if (!text) return;
    // Your existing handler can go here. For now, just echo.
    appendChat('You', text);
    chatInput.value = '';
  };

  // If your HTML uses inline handlers like onclick="send()", keep it happy:
  window.handleSend = doSend; // expose a global shim just in case

  if (chatForm) chatForm.addEventListener('submit', doSend);
  if (chatSend) chatSend.addEventListener('click', doSend);
  if (chatInput) chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) doSend(e);
  });
}

function appendChat(author, text) {
  let box = document.getElementById('chat-box') || document.querySelector('.chat-box');
  if (!box) {
    // minimal fallback
    box = document.createElement('div');
    box.id = 'chat-box';
    box.style.cssText = 'position:fixed;right:12px;bottom:60px;width:320px;max-height:50vh;overflow:auto;background:#111;color:#eee;padding:10px;border-radius:10px';
    document.body.appendChild(box);
  }
  const row = document.createElement('div');
  row.style.margin = '6px 0';
  row.innerHTML = `<b>${author}:</b> ${text}`;
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

// ---------- Buttons (your IDs) ----------
function wireButtons() {
  const byId = (id) => document.getElementById(id);

  // Load Seed JSON (force read from /seed/manifest.json)
  const btnLoadDefault = byId('btn-load-default');
  if (btnLoadDefault) {
    btnLoadDefault.addEventListener('click', async () => {
      try {
        const res = await loadGame({ modularBase: '/seed/' });
        setGame(res);
        announce('🌱 Fresh seed loaded from /seed/.');
        // optional: sync to local
        localStorage.setItem('ccsf_state', JSON.stringify(game.state));
      } catch (e) {
        console.error(e);
        announce('⚠️ Could not load /seed/. Check that /seed/manifest.json exists and paths are correct.');
      }
    });
  }

  // Import JSON (single file)
  const btnImport = byId('btn-import');
  const fileImport = byId('file-import'); // <input type=file>
  if (btnImport && fileImport) {
    btnImport.addEventListener('click', () => fileImport.click());
    fileImport.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const res = await loadGame({ bundleUrl: f });
        setGame(res);
        announce('📦 Save imported.');
        localStorage.setItem('ccsf_state', JSON.stringify(game.state));
      } catch (err) {
        console.error(err);
        announce('❌ Invalid or corrupted save file.');
      } finally {
        e.target.value = '';
      }
    });
  }

  // Export JSON
  const btnExport = byId('btn-export');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      if (!game?.state) return announce('😵 No game state to export.');
      exportBundle(game.state);
      announce('💾 Save exported.');
    });
  }

  // Save (Local)
  const btnSaveLocal = byId('btn-save-local');
  if (btnSaveLocal) {
    btnSaveLocal.addEventListener('click', () => {
      if (!game?.state) return announce('😵 No game state to save.');
      localStorage.setItem('ccsf_state', JSON.stringify(game.state));
      announce('📍 Save written to localStorage.');
    });
  }

  // Clear Local Save
  const btnClearLocal = byId('btn-clear-local');
  if (btnClearLocal) {
    btnClearLocal.addEventListener('click', () => {
      localStorage.removeItem('ccsf_state');
      announce('🗑️ Local save cleared.');
    });
  }
}

// ---------- Boot flow ----------
function loadLocal() {
  try {
    const raw = localStorage.getItem('ccsf_state');
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (!state?.meta?.season || !state?.meta?.timeline) return null;
    return state;
  } catch { return null; }
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    announce('⏳ Booting paddock…');

    // Chat & buttons first so UI is alive even if data fetch fails
    wireChatUI();
    wireButtons();

    // Resume from local if available
    const cached = loadLocal();
    if (cached) {
      setGame({
        manifest: { version: '2025.0.1', season: cached.meta.season || 2025, timeline: cached.meta.timeline || 'preseason' },
        state: cached
      });
      announce('♻️ Resumed from local save.');
      return;
    }

    // Try bundle, else modular seed
    const res = await bootGame({ defaultBundle: '/saves/slot1.ccsf.json', modularBase: '/seed/' });
    setGame(res);
    announce('✅ Seed loaded successfully! The grid is ready — time to play.');

    // optional: write first boot to local too
    localStorage.setItem('ccsf_state', JSON.stringify(game.state));
  } catch (err) {
    console.error('BOOT ERROR:', err);
    announce('💥 Boot failed. Likely causes: wrong <script> tag, missing /seed/manifest.json, or bad loader path.');
  }
});
