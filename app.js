const chatEl = document.getElementById('chat');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const clearBtn = document.getElementById('clear');
const tpl = document.getElementById('bubble');

const STORAGE_KEY = 'pwa-chatgpt-history-v1';
let history = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

function now() { return new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }

function addMessage(role, content, time = now()) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.classList.toggle('user', role === 'user');
  node.querySelector('.content').textContent = content;
  node.querySelector('.balloon').insertAdjacentHTML('beforeend', `<span class="time">${time}</span>`);
  chatEl.appendChild(node);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function restore() {
  if (history.length === 0) { addMessage('assistant', 'Hi! I am DS AI. Ask me anything.'); return; }
  history.forEach(m => addMessage(m.role, m.content, m.time));
}

async function send() {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  const msg = { role:'user', content:text, time: now() };
  history.push(msg);
  addMessage('user', text, msg.time);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));

  addMessage('assistant', 'Thinking…', now());
  const thinkingEl = chatEl.lastElementChild.querySelector('.content');
  thinkingEl.classList.add('thinking');

  try {
    const res = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type':'application/json' },
  body: JSON.stringify({
    messages: [
      { role:'system', content:'You are ChatGPT, a helpful and concise assistant.'},
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

// ===== Game State =====
const LS_KEY = 'f1-chaos-game-v1';
let GAME = null;

// Default seed URL (put a real file in your repo, see section 3)
const SEED_URL = '/data/ccsf_master.json';

// UI refs
const elPreview = document.getElementById('game-preview');
const elImport = document.getElementById('file-import');
const btnLoadDefault = document.getElementById('btn-load-default');
const btnImport = document.getElementById('btn-import');
const btnExport = document.getElementById('btn-export');
const btnSaveLocal = document.getElementById('btn-save-local');
const btnClearLocal = document.getElementById('btn-clear-local');
// const btnSaveCloud = document.getElementById('btn-save-cloud');
// const btnLoadCloud = document.getElementById('btn-load-cloud');

// Boot: try restore from local first
restoreLocal();

// ----- Core -----
function setGame(obj) {
  GAME = obj || {};
  // TODO: rerender any UI that depends on GAME, e.g. teams/drivers
  renderPreview();
}

function renderPreview() {
  if (!elPreview) return;
  try {
    elPreview.textContent = JSON.stringify(GAME, null, 2);
  } catch {
    elPreview.textContent = '<< invalid game >>';
  }
}

function restoreLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      setGame(JSON.parse(raw));
      console.info('[GAME] Restored from localStorage');
      return;
    }
  } catch (e) {
    console.warn('[GAME] local restore failed', e);
  }
  setGame({ note: 'Empty state. Load seed or import your JSON.' });
}

function saveLocal() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(GAME));
    toast('Saved locally ✅');
  } catch (e) {
    console.error(e);
    toast('Failed to save locally ❌');
  }
}

function clearLocal() {
  localStorage.removeItem(LS_KEY);
  toast('Local save cleared 🧹');
}

// Seed loader (read-only file from repo)
async function loadSeed() {
  const res = await fetch(SEED_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('Seed JSON not found: ' + SEED_URL);
  const data = await res.json();
  setGame(data);
  toast('Seed loaded 📦');
}

// Import from file chooser
function importFileDialog() {
  elImport.click();
}

elImport?.addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    setGame(obj);
    toast(`Imported ${file.name} ✅`);
  } catch (e) {
    console.error(e);
    toast('Invalid JSON file ❌');
  } finally {
    ev.target.value = '';
  }
});

// Export current state
function exportJSON() {
  try {
    const blob = new Blob([JSON.stringify(GAME, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const filename = `f1-chaos-save-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Exported 💾');
  } catch (e) {
    console.error(e);
    toast('Export failed ❌');
  }
}

// Optional: send GAME to LLM as context
function systemGameContext() {
  return {
    role: 'system',
    content: `You are F1 Management Simulator. Cynical, meme vibe. Keep rumours simple.
GameState(JSON): ${JSON.stringify(GAME).slice(0, 12000)}`
  };
}

// Example: use in your existing ask/LLM call:
// messages = [systemGameContext(), ...messages];

// ----- Wire buttons -----
btnLoadDefault?.addEventListener('click', () => loadSeed().catch(e => toast(e.message)));
btnImport?.addEventListener('click', importFileDialog);
btnExport?.addEventListener('click', exportJSON);
btnSaveLocal?.addEventListener('click', saveLocal);
btnClearLocal?.addEventListener('click', clearLocal);

// Tiny toast helper
function toast(msg) {
  console.log('[TOAST]', msg);
  if (!('Notification' in window)) return;
  // Optional: integrate with your UI; for now console is enough.
}

