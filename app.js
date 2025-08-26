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
