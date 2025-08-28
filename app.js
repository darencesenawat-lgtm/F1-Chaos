// app.js — F1 Chaos hybrid boot (modular seed + single-file saves)
// vibe: minimal, fast, no sandbagging.

import { bootGame, loadGame, exportBundle } from './loader.js';

let game; // { manifest, state }

// --- tiny helpers ---
function saveLocal(state) {
  try {
    localStorage.setItem('ccsf_state', JSON.stringify(state));
    announce('📍 Save written to localStorage.');
  } catch (e) {
    console.error(e);
    announce('⚠️ Failed to save to localStorage.');
  }
}
function loadLocal() {
  try {
    const raw = localStorage.getItem('ccsf_state');
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (!state?.meta?.season || !state?.meta?.timeline) return null;
    return state;
  } catch {
    return null;
  }
}
function clearLocal() {
  localStorage.removeItem('ccsf_state');
  announce('🗑️ Local save cleared.');
}
function setGame(newGame) {
  game = newGame;
  // TODO: refresh your UI from game.state here (tables, charts, whatever)
}

// --- boot flow ---
window.addEventListener('DOMContentLoaded', async () => {
  // 0) try local storage (instant resume)
  const cached = loadLocal();
  if (cached) {
    // fabricate a minimal manifest from cached state
    setGame({
      manifest: { version: '2025.0.1', season: cached.meta.season || 2025, timeline: cached.meta.timeline || 'preseason' },
      state: cached
    });
    announce('♻️ Resumed from local save.');
  } else {
    // 1) try player bundle (/saves/slot1.ccsf.json); else fall back to /seed/
    try {
      const res = await bootGame({ defaultBundle: '/saves/slot1.ccsf.json', modularBase: '/seed/' });
      setGame(res);
      announce('✅ Seed loaded successfully! The grid is ready — time to play.');
      // optional: auto-save first boot into localStorage too
      saveLocal(game.state);
    } catch (e) {
      console.error(e);
      announce('❌ Failed to boot. Check /seed/manifest.json and try again.');
      return;
    }
  }

  // --- Button wiring (IDs from your HTML) ---

  // 1) Load Seed JSON (force reload from modular /seed/)
  const btnLoadDefault = document.getElementById('btn-load-default');
  if (btnLoadDefault) {
    btnLoadDefault.onclick = async () => {
      try {
        const res = await loadGame({ modularBase: '/seed/' });
        setGame(res);
        announce('🌱 Fresh seed loaded from /seed/.');
      } catch (e) {
        console.error(e);
        announce('⚠️ Could not load /seed/ — check manifest.json.');
      }
    };
  }

  // 2) Import JSON (single-file bundle picked by player)
  const btnImport = document.getElementById('btn-import');
  const fileImport = document.getElementById('file-import'); // hidden <input type=file>
  if (btnImport && fileImport) {
    btnImport.onclick = () => fileImport.click();
    fileImport.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const res = await loadGame({ bundleUrl: f });
        setGame(res);
        announce('📦 Save imported. Back in the paddock.');
        // optional: sync to localStorage on import
        saveLocal(game.state);
      } catch (err) {
        console.error(err);
        announce('❌ Invalid or corrupted save file.');
      } finally {
        e.target.value = ''; // reset file input
      }
    });
  }

  // 3) Export JSON (one-file .ccsf.json)
  const btnExport = document.getElementById('btn-export');
  if (btnExport) {
    btnExport.onclick = () => {
      if (!game?.state) return announce('😵 No game state to export.');
      exportBundle(game.state);
      announce('💾 Save exported.');
    };
  }

  // 4) Save (Local)
  const btnSaveLocal = document.getElementById('btn-save-local');
  if (btnSaveLocal) {
    btnSaveLocal.onclick = () => {
      if (!game?.state) return announce('😵 No game state to save.');
      saveLocal(game.state);
    };
  }

  // 5) Clear Local Save
  const btnClearLocal = document.getElementById('btn-clear-local');
  if (btnClearLocal) {
    btnClearLocal.onclick = () => {
      clearLocal();
    };
  }
});
