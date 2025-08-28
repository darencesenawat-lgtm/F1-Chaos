// app.js — new boot
import { bootGame, exportBundle, loadGame } from './loader.js';

let game; // global game handle for your UI

window.addEventListener('DOMContentLoaded', async () => {
  // Try player save first; else load modular /seed/ and auto-init
  game = await bootGame({ defaultBundle: '/saves/slot1.ccsf.json', modularBase: '/seed/' });

  // Your UI kick-off here
  announce('✅ Seed loaded successfully! The grid is ready — time to play.');

  // Wire buttons (optional; add if you have these IDs)
  const btnExport = document.getElementById('btnExport');
  if (btnExport) btnExport.onclick = () => exportBundle(game.state);

  const fileInput = document.getElementById('importFile'); // <input type="file" accept=".json">
  const btnImport = document.getElementById('btnImport');
  if (btnImport && fileInput) {
    btnImport.onclick = () => fileInput.click();
    fileInput.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      // Import a single-file save the player picked
      const res = await loadGame({ bundleUrl: f });
      game = res;
      announce('📦 Save imported. Back in the paddock.');
      // TODO: refresh your UI from `game.state`
    });
  }
});


const chatEl = document.getElementById('chat');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const clearBtn = document.getElementById('clear');


const STORAGE_KEY = 'pwa-chatgpt-history-v1';
let history = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

function now() { return new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }

function addMessage(role, content, time = now()) {
  const chat = document.getElementById('chat');
  if (!chat) return console.warn('#chat not found');

  const tpl = document.getElementById('bubble'); // expects <template id="bubble">
  let node;
  if (tpl && tpl.content && tpl.content.firstElementChild) {
    node = tpl.content.firstElementChild.cloneNode(true);
  } else {
    node = document.createElement('div');
    node.className = 'balloon';
    node.innerHTML = `
      <div class="content"></div>
      <span class="time"></span>
    `;
  }

  node.classList.toggle('user', role === 'user');
  node.querySelector('.content').textContent = content;
  const timeEl = node.querySelector('.time');
  if (timeEl) timeEl.textContent = time;
  chat.appendChild(node);
  chat.scrollTop = chat.scrollHeight;
}

function restore() {
  if (history.length === 0) { addMessage('assistant', 'Hi! I am DS AI. Ask me anything.'); return; }
  history.forEach(m => addMessage(m.role, m.content, m.time));
}
function systemGameContext() {
  return {
    role: 'system',
    content: `You are F1 Management Simulator. Cynical, meme vibe. Keep rumours simple.
Read GameState(JSON) and answer user queries about drivers/teams/finance without asking what they mean.

GameState(JSON):
${JSON.stringify(GAME).slice(0, 12000)}`
  };
}

async function send() {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  const msg = { role:'user', content:text, time: now() };
  history.push(msg);
  addMessage('user', text, msg.time);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
const textLC = text.toLowerCase();

  function listDrivers() {
    if (!GAME || !Array.isArray(GAME.drivers)) return "No drivers in GameState.";
    return GAME.drivers.map(d => `- ${d.name || d.id} ${d.team ? `(${d.team})` : ''}`).join('\n');
  }

  if (/^driver(s)? list$/.test(textLC) || /^list driver(s)?$/.test(textLC)) {
    const reply = listDrivers();
    addMessage('assistant', reply, now());
    history.push({ role:'assistant', content: reply, time: now() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    return; // ⬅️ stop here, don't call API
  }
  addMessage('assistant', 'Thinking…', now());
  const thinkingEl = chatEl.lastElementChild.querySelector('.content');
  thinkingEl.classList.add('thinking');

  try {
    const res = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type':'application/json' },
  body: JSON.stringify({
    messages: [
        systemGameContext(),
        { role:'system', content:'Reply concisely in bullet points when listing drivers/teams.'},
        ...history.map(({role, content}) => ({role, content}))
    ]
  })
});
const data = await res.json();
const reply = data.reply;
if (data.error) {
  thinkingEl.classList.remove('thinking');
  thinkingEl.textContent = 'Error: ' + data.error;
} else {
  thinkingEl.classList.remove('thinking');
  thinkingEl.textContent = reply || 'No reply.';
  history.push({ role:'assistant', content: reply || 'No reply.', time: now() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}
  } catch (err) {
    thinkingEl.classList.remove('thinking');
    thinkingEl.textContent = 'Error: ' + (err?.message || 'Failed to reach /api/chat');
  }
}

sendBtn.addEventListener('click', send);
inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
clearBtn.addEventListener('click', () => { history = []; localStorage.removeItem(STORAGE_KEY); chatEl.innerHTML = ''; restore(); });
restore();
// ----- Game State -----
const LS_KEY = 'f1-chaos-game-v1';
let GAME = null;
const SEED_URL = '/data/ccsf_master.json';

const elPreview = document.getElementById('game-preview');
const elImport = document.getElementById('file-import');
const btnLoadDefault = document.getElementById('btn-load-default');
const btnImport = document.getElementById('btn-import');
const btnExport = document.getElementById('btn-export');
const btnSaveLocal = document.getElementById('btn-save-local');
const btnClearLocal = document.getElementById('btn-clear-local');

function setGame(obj) {
  GAME = obj || {};
  renderPreview();
  try { localStorage.setItem(LS_KEY, JSON.stringify(GAME)); } catch {}
}

function renderPreview() {
  if (!elPreview) return;
  try { elPreview.textContent = JSON.stringify(GAME, null, 2); }
  catch { elPreview.textContent = '<< invalid game >>'; }
}

function restoreLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      setGame(JSON.parse(raw));
      console.info('[GAME] Restored from localStorage');
      return;
    }
  } catch (e) { console.warn('[GAME] local restore failed', e); }
  setGame({ note: 'Empty state. Load seed or import your JSON.' });
}

function saveLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(GAME)); toast('Saved locally ✅'); }
  catch (e) { console.error(e); toast('Failed to save locally ❌'); }
}

function clearLocal() {
  localStorage.removeItem(LS_KEY);
  toast('Local save cleared 🧹');
}



function importFileDialog() { elImport?.click(); }

elImport?.addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    setGame(obj);
    announce(`✅ Save loaded: ${file.name}. Parc fermé complete — resume chaos.`);

    // Rumour 5%
    if (Math.random() < 0.05) {
      const rumours = [
        "🔮 Rumour: FIA might drop a surprise TD before next race.",
        "📉 Whisper: one team is over budget… penalties incoming?",
        "👀 Paddock says a TP is about to be sacked.",
        "🍕 Engineers spotted ordering pineapple pizza — morale crisis?",
        "🕵️ Sources claim a driver’s secretly testing for another team."
      ];
      announce(rumours[Math.floor(Math.random() * rumours.length)]);
    }
  } catch (e) {
    console.error(e);
    announce('❌ That file is not valid JSON. Bring it back to the garage.');
  } finally {
    ev.target.value = '';
  }
});

function exportJSON() {
  try {
    const blob = new Blob([JSON.stringify(GAME, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const filename = `f1-chaos-save-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('Exported 💾');
  } catch (e) { console.error(e); toast('Export failed ❌'); }
}

function announce(msg) {
  const time = now();
  addMessage('assistant', msg, time);
  history.push({ role:'assistant', content: msg, time });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

function toast(msg) {
  console.log('[TOAST]', msg);
  // Optionally wire a visual toast UI here
}

// Wire buttons (single set)
btnLoadDefault?.addEventListener('click', () => loadSeed().catch(e => toast(e.message)));
btnImport?.addEventListener('click', importFileDialog);
btnExport?.addEventListener('click', exportJSON);
btnSaveLocal?.addEventListener('click', saveLocal);
btnClearLocal?.addEventListener('click', clearLocal);

// Boot
restoreLocal();
