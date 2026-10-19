import { api, esc, money, toast, compressImage } from '../lib.js';
import { openEditor } from '../components/editor.js';

let el, queueEl, attentionEl;
const queue = [];
let running = false;

function mount(root) {
  el = root;
  el.innerHTML = `
    <div class="card upload-card">
      <h2>Add receipts</h2>
      <p class="muted">Photos are read by your AI and saved automatically. Anything it can't read is flagged for review.</p>
      <div class="upload-actions">
        <label class="btn primary big">
          <input type="file" accept="image/*" capture="environment" hidden data-in="camera">
          Take photo
        </label>
        <label class="btn big">
          <input type="file" accept="image/*,application/pdf" multiple hidden data-in="files">
          Choose files
        </label>
      </div>
    </div>
    <div class="card" data-sec="queue" hidden>
      <h3>This session</h3>
      <ul class="list" id="queue"></ul>
    </div>
    <div class="card" data-sec="attention" hidden>
      <h3>Needs attention</h3>
      <ul class="list" id="attention"></ul>
    </div>`;

  queueEl = el.querySelector('#queue');
  attentionEl = el.querySelector('#attention');

  el.querySelectorAll('input[type=file]').forEach((input) =>
    input.addEventListener('change', () => {
      addFiles([...input.files]);
      input.value = '';
    })
  );
}

function show() { loadAttention(); }

function addFiles(files) {
  for (const file of files) {
    const item = { file, state: 'waiting', row: null, li: document.createElement('li') };
    queue.push(item);
    queueEl.prepend(item.li);
    render(item);
  }
  el.querySelector('[data-sec="queue"]').hidden = false;
  runQueue();
}

// One at a time: the AI box processes sequentially anyway.
async function runQueue() {
  if (running) return;
  running = true;
  let item;
  while ((item = queue.find((q) => q.state === 'waiting'))) {
    item.state = 'uploading';
    render(item);
    try {
      const file = await compressImage(item.file);
      const fd = new FormData();
      fd.append('file', file, file.name);
      item.state = 'reading';
      render(item);
      item.row = await api('/receipts', { method: 'POST', body: fd });
      item.state = item.row.status;
    } catch (e) {
      item.state = 'error';
      item.message = e.message;
    }
    render(item);
  }
  running = false;
  loadAttention();
}

const LABEL = {
  waiting: 'Waiting', uploading: 'Uploading…', reading: 'AI reading…',
  ok: 'Saved', review: 'Needs review', failed: 'AI failed', error: 'Upload failed',
};

function render(item) {
  const r = item.row;
  const title = r?.merchant || item.file.name;
  const sub = r ? [r.txn_date, r.category].filter(Boolean).join(' · ') : '';
  const note = r?.error || item.message || '';
  item.li.className = 'row';
  item.li.innerHTML = `
    <div class="row-main">
      <span class="row-title">${esc(title)}</span>
      <span class="row-sub">${esc(sub || note)}</span>
      ${sub && note ? `<span class="row-sub warn-text">${esc(note)}</span>` : ''}
    </div>
    <div class="row-end">
      ${r && r.total !== null ? `<span class="amount">${money(r.total, r.currency)}</span>` : ''}
      <span class="pill ${pillClass(item.state)}">${LABEL[item.state]}</span>
    </div>`;
  item.li.onclick = r ? () => openEditor(r.id, (changed) => {
    if (changed.deleted) { item.li.remove(); return; }
    item.row = changed; item.state = changed.status; render(item); loadAttention();
  }) : null;
  item.li.classList.toggle('clickable', Boolean(r));
}

const pillClass = (s) => ({ ok: 'ok', review: 'warn', failed: 'bad', error: 'bad' }[s] || 'busy');

async function loadAttention() {
  try {
    const { receipts } = await api('/receipts?status=review,failed');
    const sec = el.querySelector('[data-sec="attention"]');
    sec.hidden = receipts.length === 0;
    attentionEl.innerHTML = '';
    for (const r of receipts) {
      const li = document.createElement('li');
      li.className = 'row clickable';
      li.innerHTML = `
        <div class="row-main">
          <span class="row-title">${esc(r.merchant || r.file_name || 'Unreadable receipt')}</span>
          <span class="row-sub">${esc(r.error || '')}</span>
        </div>
        <div class="row-end">
          ${r.total !== null ? `<span class="amount">${money(r.total, r.currency)}</span>` : ''}
          <span class="pill ${r.status === 'failed' ? 'bad' : 'warn'}">${r.status === 'failed' ? 'AI failed' : 'Review'}</span>
        </div>`;
      li.onclick = () => openEditor(r.id, () => loadAttention());
      attentionEl.append(li);
    }
  } catch (e) {
    toast(e.message, 'bad');
  }
}

export default { mount, show };
