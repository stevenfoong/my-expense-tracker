// Storage section (Settings tab): usage against free limits, per-year download and delete.
import { api, esc, toast, fmtDate } from '../lib.js';
import { downloadZip } from '../vendor/client-zip.js';

const PART_LIMIT = 250 * 1024 ** 2; // without a save-to-disk picker, split large years into ZIPs of about this size

export function formatBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

let box, data, busyYear = null;

export async function mountStorage(container) {
  box = container;
  box.innerHTML = '<p class="muted small">Checking storage…</p>';
  try { data = await api('/storage'); render(); }
  catch (e) { box.innerHTML = `<p class="bad-text small">${esc(e.message)}</p>`; }
}

function meter(label, used, limit, note) {
  const pct = used == null ? 0 : Math.min(100, (used / limit) * 100);
  return `
    <div class="meter">
      <div class="meter-head"><span>${label}</span><span><strong>${formatBytes(used)}</strong> of ${formatBytes(limit)}</span></div>
      <div class="meter-track" role="progressbar" aria-valuenow="${pct.toFixed(1)}" aria-valuemin="0" aria-valuemax="100" aria-label="${label}">
        <span class="meter-fill ${pct > 80 ? 'warn' : ''}" style="width:${Math.max(pct, used ? 0.5 : 0)}%"></span>
      </div>
      <small class="muted">${note}</small>
    </div>`;
}

function render() {
  const d = data;
  box.innerHTML = `
    ${meter('Files (R2)', d.r2.bytes, d.r2.limit, `${d.r2.objects} files · ${(d.r2.bytes / d.r2.limit * 100).toFixed(1)}% of the free 10 GB`)}
    ${meter('Database (D1)', d.d1.bytes, d.d1.limit, d.d1.bytes == null ? 'Size not available' : `${(d.d1.bytes / d.d1.limit * 100).toFixed(2)}% of the free 500 MB`)}
    <h3>By year</h3>
    <ul class="list years">
      ${d.years.map(yearRow).join('') || '<li class="empty muted">Nothing stored yet.</li>'}
    </ul>
    ${d.other.objects ? `<p class="muted small">Other files not linked to any record: ${d.other.objects} (${formatBytes(d.other.bytes)})</p>` : ''}
    <p class="muted small">Download gives a ZIP with the year's receipt images, statement PDFs and a receipts.csv of all records. Delete removes only the images and PDFs; your spending records stay.</p>`;

  box.querySelectorAll('[data-download]').forEach((b) => b.addEventListener('click', () => startDownload(b.dataset.download)));
  box.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', () => startDelete(b.dataset.delete)));
}

function yearRow(y) {
  const files = y.images + y.statements;
  const downloaded = y.downloaded_at && !y.added_since_download;
  const working = busyYear === y.year;
  return `
    <li class="year-row">
      <div class="row-main">
        <span class="row-title">${y.year}</span>
        <span class="row-sub">${y.records} record${y.records === 1 ? '' : 's'} · ${y.images} image${y.images === 1 ? '' : 's'}${y.statements ? ` · ${y.statements} statement${y.statements === 1 ? '' : 's'}` : ''} · <strong>${formatBytes(y.bytes)}</strong></span>
        ${y.downloaded_at ? `<span class="row-sub ${downloaded ? 'ok-text' : 'warn-text'}">${downloaded
          ? `Downloaded ${fmtDate(y.downloaded_at.slice(0, 10))}`
          : `Downloaded ${fmtDate(y.downloaded_at.slice(0, 10))}, ${y.added_since_download} added since`}</span>` : ''}
        <span class="row-sub progress" data-progress="${y.year}"></span>
      </div>
      <div class="year-actions">
        <button type="button" class="btn small" data-download="${y.year}" ${working || !y.records ? 'disabled' : ''}>Download</button>
        <button type="button" class="btn small ghost danger" data-delete="${y.year}" ${working || !files ? 'disabled' : ''}>Delete files</button>
      </div>
    </li>`;
}

/* ---------------- Download ---------------- */

const slug = (s) => String(s || 'receipt').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'receipt';
const extOf = (r) => (r.file_type === 'application/pdf' ? 'pdf' : (r.file_type || 'image/jpeg').split('/')[1].replace('jpeg', 'jpg'));
const csvCell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

function buildCsv(receipts) {
  const cols = ['txn_date', 'merchant', 'total', 'currency', 'foreign_currency', 'foreign_amount', 'category', 'area',
    'payment_method', 'status', 'on_statement', 'notes', 'file'];
  const rows = receipts.map((r) => [r.txn_date, r.merchant, r.total, r.currency, r.foreign_currency, r.foreign_amount, r.category, r.area,
    r.payment_method, r.status, r.statement_line_id ? 'yes' : '', r.notes, r.zip_name || '']);
  return '﻿' + [cols, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function setProgress(year, text) {
  const p = box.querySelector(`[data-progress="${year}"]`);
  if (p) p.textContent = text;
}

/** Downloads the year's archive. Returns true when every part was saved. */
async function downloadYear(year) {
  const c = await api('/storage/' + year);
  const files = [];
  for (const r of c.receipts) {
    if (!r.has_file) continue;
    r.zip_name = `receipts/${r.txn_date || 'undated'}_${slug(r.merchant)}_${r.total ?? r.foreign_amount ?? 0}_${r.id.slice(0, 8)}.${extOf(r)}`;
    files.push({ name: r.zip_name, url: `/api/receipts/${r.id}/file`, size: r.size, date: r.txn_date });
  }
  for (const s of c.statements) {
    if (s.has_file) files.push({ name: `statements/statement_${s.statement_date || s.id.slice(0, 8)}.pdf`, url: `/api/statements/${s.id}/file`, size: s.size, date: s.statement_date });
  }
  const csv = { name: 'receipts.csv', input: buildCsv(c.receipts), size: 0 };

  const canStream = 'showSaveFilePicker' in window;
  const parts = [];
  let cur = [], curSize = 0;
  for (const f of files) {
    if (!canStream && cur.length && curSize + f.size > PART_LIMIT) { parts.push(cur); cur = []; curSize = 0; }
    cur.push(f); curSize += f.size;
  }
  parts.push(cur);

  let done = 0;
  const total = files.length;
  for (let i = 0; i < parts.length; i++) {
    const suffix = parts.length > 1 ? `-part${i + 1}of${parts.length}` : '';
    const fileName = `expenses-${year}${suffix}.zip`;

    async function* entries() {
      if (i === 0) yield { name: csv.name, input: csv.input, lastModified: new Date() };
      for (const f of parts[i]) {
        const res = await fetch(f.url);
        if (!res.ok) throw new Error(`Could not fetch ${f.name} (${res.status})`);
        done++;
        setProgress(year, `Downloading ${done} of ${total} files…`);
        yield { name: f.name, input: res, lastModified: f.date ? new Date(f.date) : new Date() };
      }
    }

    if (canStream) {
      let handle;
      try {
        handle = await window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }] });
      } catch { return false; } // cancelled
      await downloadZip(entries()).body.pipeTo(await handle.createWritable());
    } else {
      if (i > 0 && !confirm(`Part ${i} saved. Download part ${i + 1} of ${parts.length}?`)) return false;
      const blob = await downloadZip(entries()).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    }
  }
  await api(`/storage/${year}/downloaded`, { method: 'POST' });
  return true;
}

async function startDownload(year) {
  busyYear = year; render();
  setProgress(year, 'Preparing download…');
  try {
    const ok = await downloadYear(year);
    if (ok) toast(`${year} downloaded`, 'ok');
  } catch (e) {
    toast('Download failed: ' + e.message, 'bad');
  }
  busyYear = null;
  data = await api('/storage');
  render();
}

/* ---------------- Delete ---------------- */

let dialog;
function ask(html, buttons) {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'editor narrow';
    document.body.append(dialog);
  }
  dialog.innerHTML = `<div class="editor-body">${html}<div class="editor-actions"><span class="spacer"></span>${buttons
    .map((b, i) => `<button type="button" class="btn ${b.cls || ''}" data-i="${i}">${b.label}</button>`).join('')}</div></div>`;
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { dialog.close(); resolve(buttons[+b.dataset.i].value); }));
    dialog.addEventListener('cancel', () => resolve(null), { once: true });
  });
}

async function startDelete(year) {
  const y = data.years.find((x) => x.year === year);
  const files = y.images + y.statements;
  const downloaded = y.downloaded_at && !y.added_since_download;

  if (!downloaded) {
    const why = y.downloaded_at
      ? `${y.added_since_download} receipt${y.added_since_download === 1 ? ' was' : 's were'} added since you last downloaded ${year}.`
      : `You haven't downloaded ${year} yet.`;
    const choice = await ask(
      `<h2>Download ${year} first?</h2><p>${why} Deleted images can't be recovered, so it's worth keeping a copy.</p>`,
      [{ label: 'Cancel', cls: 'ghost', value: null }, { label: 'Delete without download', cls: 'ghost danger', value: 'skip' }, { label: 'Download first', cls: 'primary', value: 'download' }]
    );
    if (!choice) return;
    if (choice === 'download') {
      await startDownload(year);
      const fresh = data.years.find((x) => x.year === year);
      if (!fresh?.downloaded_at || fresh.added_since_download) return; // download cancelled or failed
    }
  }

  const sure = await ask(
    `<h2>Delete ${year} files?</h2>
     <p>This permanently deletes <strong>${y.images} receipt image${y.images === 1 ? '' : 's'}</strong>${y.statements ? ` and <strong>${y.statements} statement PDF${y.statements === 1 ? '' : 's'}</strong>` : ''} from ${year} (${formatBytes(y.bytes)}).</p>
     <p class="muted small">Your ${y.records} spending records stay, with all amounts and categories. Only the pictures are removed.</p>`,
    [{ label: 'Cancel', cls: 'ghost', value: false }, { label: "I'm sure, delete", cls: 'danger-solid', value: true }]
  );
  if (!sure) return;

  busyYear = year; render();
  setProgress(year, `Deleting ${files} files…`);
  try {
    const r = await api('/storage/' + year, { method: 'DELETE' });
    toast(`Deleted ${r.files} files (${formatBytes(r.bytes)}) from ${year}`, 'ok');
  } catch (e) {
    toast(e.message, 'bad');
  }
  busyYear = null;
  data = await api('/storage');
  render();
}
