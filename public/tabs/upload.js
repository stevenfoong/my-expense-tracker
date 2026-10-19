import { api, esc, money, fmtDate, toast, compressImage } from '../lib.js';
import { openEditor } from '../components/editor.js';

const RECENT_COUNT = 10;

let el, queueEl, attentionEl, recentEl;
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
      <h3>Uploading</h3>
      <ul class="list" id="queue"></ul>
    </div>
    <div class="card" data-sec="attention" hidden>
      <h3>Needs attention</h3>
      <ul class="list" id="attention"></ul>
    </div>
    <div class="card" data-sec="recent" hidden>
      <h3>Recent uploads</h3>
      <ul class="list" id="recent"></ul>
    </div>`;

  queueEl = el.querySelector('#queue');
  attentionEl = el.querySelector('#attention');
  recentEl = el.querySelector('#recent');

  el.querySelectorAll('input[type=file]').forEach((input) =>
    input.addEventListener('change', () => {
      addFiles([...input.files]);
      input.value = '';
    })
  );
}

function show() { refreshLists(); }

function refreshLists() {
  loadAttention();
  loadRecent();
}

/* ---------- Upload queue (only shows files still in progress or failed to upload) ---------- */

function addFiles(files) {
  for (const file of files) {
    const item = { file, state: 'waiting', li: document.createElement('li') };
    queue.push(item);
    queueEl.append(item.li);
    renderQueueItem(item);
  }
  updateQueueVisibility();
  runQueue();
}

// One at a time: the AI box processes sequentially anyway.
async function runQueue() {
  if (running) return;
  running = true;
  let item;
  while ((item = queue.find((q) => q.state === 'waiting'))) {
    item.state = 'uploading';
    renderQueueItem(item);
    try {
      const file = await compressImage(item.file);
      const fd = new FormData();
      fd.append('file', file, file.name);
      item.state = 'reading';
      renderQueueItem(item);
      const row = await api('/receipts', { method: 'POST', body: fd });
      // Done: drop it from the queue; it now appears under Recent uploads.
      item.li.remove();
      queue.splice(queue.indexOf(item), 1);
      if (row.status === 'ok') toast(`Saved: ${row.merchant || 'receipt'} ${money(row.total, row.currency)}`, 'ok');
      else if (row.status === 'pending') toast(`Saved: ${row.merchant || 'receipt'} ${money(row.foreign_amount, row.foreign_currency)} (RM amount pending)`, 'ok');
      else toast(row.status === 'failed' ? 'AI could not read a receipt' : 'Saved, needs review', row.status === 'failed' ? 'bad' : 'warn');
    } catch (e) {
      item.state = 'error';
      item.message = e.message;
      renderQueueItem(item);
    }
    updateQueueVisibility();
    refreshLists();
  }
  running = false;
}

function updateQueueVisibility() {
  el.querySelector('[data-sec="queue"]').hidden = queue.length === 0;
}

const QUEUE_LABEL = { waiting: 'Waiting', uploading: 'Uploading…', reading: 'AI reading…', error: 'Upload failed' };

function renderQueueItem(item) {
  item.li.className = 'row';
  item.li.innerHTML = `
    <div class="row-main">
      <span class="row-title">${esc(item.file.name)}</span>
      <span class="row-sub">${esc(item.message || '')}</span>
    </div>
    <div class="row-end">
      <span class="pill ${item.state === 'error' ? 'bad' : 'busy'}">${QUEUE_LABEL[item.state]}</span>
      ${item.state === 'error' ? '<button type="button" class="btn ghost small" data-act="retry">Retry</button>' : ''}
    </div>`;
  const retry = item.li.querySelector('[data-act="retry"]');
  if (retry) retry.onclick = () => { item.state = 'waiting'; item.message = ''; renderQueueItem(item); runQueue(); };
}

/* ---------- Server-backed lists ---------- */

const STATUS_PILL = {
  ok: ['ok', 'Saved'],
  review: ['warn', 'Review'],
  failed: ['bad', 'AI failed'],
  processing: ['bad', 'Stuck'],
  pending: ['warn', 'RM pending'],
};

function receiptRow(r, { showDate = true } = {}) {
  const li = document.createElement('li');
  li.className = 'row clickable';
  const [cls, label] = STATUS_PILL[r.status] || ['busy', r.status];
  const sub = r.status === 'processing'
    ? 'Reading was interrupted. Open and press Re-run AI.'
    : r.status === 'ok' || r.status === 'pending'
      ? [showDate ? fmtDate(r.txn_date) : null, r.category].filter(Boolean).join(' · ')
      : r.error || '';
  li.innerHTML = `
    <div class="row-main">
      <span class="row-title">${esc(r.merchant || r.file_name || 'Unreadable receipt')}</span>
      <span class="row-sub">${esc(sub)}</span>
    </div>
    <div class="row-end">
      ${r.total !== null ? `<span class="amount">${money(r.total, r.currency)}</span>`
        : r.foreign_amount !== null ? `<span class="amount">${money(r.foreign_amount, r.foreign_currency)}</span>` : ''}
      <span class="pill ${cls}">${label}</span>
    </div>`;
  li.onclick = () => openEditor(r.id, () => refreshLists());
  return li;
}

async function loadAttention() {
  try {
    const { receipts } = await api('/receipts?status=review,failed,stuck,pending');
    el.querySelector('[data-sec="attention"]').hidden = receipts.length === 0;
    attentionEl.replaceChildren(...receipts.map((r) => receiptRow(r)));
  } catch (e) {
    toast(e.message, 'bad');
  }
}

async function loadRecent() {
  try {
    const { receipts } = await api('/receipts?recent=' + RECENT_COUNT);
    el.querySelector('[data-sec="recent"]').hidden = receipts.length === 0;
    recentEl.replaceChildren(...receipts.map((r) => receiptRow(r)));
  } catch (e) {
    toast(e.message, 'bad');
  }
}

export default { mount, show };
