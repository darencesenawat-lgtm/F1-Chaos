// app.js — module-safe boot + UI wiring (chat + buttons)
// Make sure index.html loads this with: <script type="module" src="app.js"></script>

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
      t.style.cssText = 'position:fixed;left:12px;bottom:12px;background:#222;color:#fff;padding:10px 12px;border-radius:8px;z-index:9999;max-width:60ch;font:14px/1.3 system-ui';
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
  // TODO: refresh your UI here from game.state (tables, cards, etc.)
  console.info('Game state set:', game);
}

// ---------- Chat UI: create if missing + module-safe wiring ----------
function mountChat() {
  let chatBox  = document.getElementById('chat-box')  || document.querySelector('.chat-box');
  let chatForm = document.getElementById('chat-form');
  let chatInput = document.getElementById('chat-input') || document.querySelector('input[name="chat"]');
  let chatSend  = document.getElementById('chat-send')  || document.querySelector('[data-action="send"]');

  if (!chatBox) {
    chatBox = document.createElement('div');
    chatBox.id = 'chat-box';
    chatBox.style.cssText = 'position:fixed;right:16px;bottom:96px;width:340px;max-height:45vh;overflow:auto;background:#111;color:#eee;padding:10px;border-radius:10px;box-shadow:0 6px 30px rgba(0,0,0,.4);z-index:9998;font:14px/1.35 system-ui';
    document.body.appendChild(chatBox);
  }

  if (!chatForm) {
    chatForm = document.createElement('form');
    chatForm.id = 'chat-form';
    chatForm.style.cssText = 'position:fixed;right:16px;bottom:16px;width:340px;display:flex;gap:8px;z-index:9999';
    chatForm.innerHTML = `
      <input id="chat-input" placeholder="type here…" autocomplete="off"
             style="flex:1;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#181818;color:#eee;">
      <button id="chat-send" type="submit"
              style="padding:10px 12px;border-radius:8px;border:0;background:#ff6b00;color:#fff;font-weight:600">Send</button>
    `;
    document.body.appendChild(chatForm);
    chatInput = chatForm.querySelector('#chat-input');
    chatSend  = chatForm.querySelector('#chat-send');
  }

  const appendChat = (author, text) => {
    const row = document.createElement('div');
    row.style.margin = '6px 0';
    row.innerHTML = `<b>${author}:</b> ${text}`;
    chatBox.appendChild(row);
    chatBox.scrollTop = chatBox.scrollHeight;
  };

  const doSend = (e) => {
    if (e) e.preventDefault();
    const text = (chatInput?.value || '').trim();
    if (!text) return;
    appendChat('You', text);
    // TODO: route this to your real handler (AI/commands/etc.)
    chatInput.value = '';
  };

  // Bind safely
  chatForm.addEventListener('submit', doSend);
  if (chatSend) chatSend.addEventListener('click', doSend);
  if (chatInput) chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) doSend(e);
  });

  // Keep old inline handlers alive if your HTML still calls send()
  window.send = doSend;
  window.handleSend = doSend;
  window.appendChat = appendChat;
}

// ---------- Buttons (your IDs) ----------
function wireButtons() {
  const byId = (id) => document.getElementById(id);

  // Load Seed JSON (force read from modular seed/)
  const btnLoadDefault = byId('btn-load-default');
  if (btnLoadDefault) {
    btnLoadDefault.addEventListener('click', async () => {
      try {
        const res = await loadGame({ modularBase: 'seed/' }); // relative path
        setGame(res);
        announce('🌱 Fresh seed loaded from seed/.');
        localStorage.setItem('ccsf_state', JSON.stringify(game.state));
      } catch (e) {
        console.error(e);
        announce('⚠️ Could not load seed/. Check seed/manifest.json exists and paths.');
      }
    });
  }

  // Import JSON (single-file bundle)
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
        localStorage.setItem('ccsf_state', JSON.stringify(game.state));
      } catch (err) {
        console.error(err);
        announce('❌ Invalid or corrupted save file.');
      } finally {
        e.target.value = ''; // reset
      }
    });
  }

  // Export JSON (one-file .ccsf.json)
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

// ---------- Local storage helpers ----------
function loadLocal() {
  try {
    const raw = localStorage.getItem('ccsf_state');
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (!state?.meta?.season || !state?.meta?.timeline) return null;
    return state;
  } catch { return null; }
}

// ---------- Boot flow ----------
window.addEventListener('DOMContentLoaded', async () => {
  try {
    announce('⏳ Booting paddock…');

    // Chat & buttons first so UI is alive even if data fetch fails
    mountChat();
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

    // Try player bundle; else modular seed (relative paths so GH Pages is happy)
    const res = await bootGame({ defaultBundle: 'saves/slot1.ccsf.json', modularBase: 'seed/' });
    setGame(res);
    announce('✅ Seed loaded successfully! The grid is ready — time to play.');

    // First boot → also cache in localStorage
    localStorage.setItem('ccsf_state', JSON.stringify(game.state));
  } catch (err) {
    console.error('BOOT ERROR:', err);
    announce('💥 Boot failed. Likely causes: missing seed/manifest.json or wrong script type.');
  }
});
