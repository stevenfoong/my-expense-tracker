// Receipt detail / edit dialog, shared by every tab.
import { api, esc, money, toast, getSettings } from '../lib.js';

let dialog;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'editor';
  document.body.append(dialog);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  return dialog;
}

/** Opens the editor. onChange(row) after save/re-run, onChange({ deleted: id }) after delete. */
export async function openEditor(id, onChange = () => {}) {
  const d = ensureDialog();
  d.innerHTML = '<div class="editor-body"><p class="muted">Loading…</p></div>';
  if (!d.open) d.showModal();

  let r, settings;
  try {
    [r, settings] = await Promise.all([api('/receipts/' + id), getSettings()]);
  } catch (e) {
    d.innerHTML = `<div class="editor-body"><p class="error">${esc(e.message)}</p><button class="btn" value="close">Close</button></div>`;
    d.querySelector('button').onclick = () => d.close();
    return;
  }

  const cats = settings.categories.includes(r.category) || !r.category ? settings.categories : [r.category, ...settings.categories];
  const fileUrl = `/api/receipts/${id}/file`;
  const preview = r.file_type === 'application/pdf'
    ? `<a class="btn ghost" href="${fileUrl}" target="_blank" rel="noopener">Open PDF</a>`
    : `<a href="${fileUrl}" target="_blank" rel="noopener"><img src="${fileUrl}" alt="Receipt image"></a>`;

  d.innerHTML = `
    <form method="dialog" class="editor-body">
      <div class="editor-head">
        <h2>Receipt</h2>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close">✕</button>
      </div>
      ${r.error ? `<p class="banner ${r.status === 'failed' ? 'bad' : 'warn'}">${esc(r.status === 'pending' ? `${settings.default_currency} amount pending: ${r.foreign_currency} ${money(r.foreign_amount)} recorded. Fill in the ${settings.default_currency} amount once you know it.` : r.error)}</p>` : ''}
      <div class="editor-grid">
        <div class="preview">${preview}</div>
        <div class="fields">
          <label>Date<input type="date" name="txn_date" value="${esc(r.txn_date)}"></label>
          <label>Merchant<input name="merchant" value="${esc(r.merchant)}" autocomplete="off"></label>
          <label>Amount (${esc(settings.default_currency)})
            <input name="total" inputmode="decimal" value="${r.total ?? ''}" placeholder="${r.foreign_amount != null ? 'Fill in after conversion' : ''}">
          </label>
          <details class="foreign" ${r.foreign_currency ? 'open' : ''}>
            <summary>Foreign currency${r.foreign_currency ? `: ${esc(r.foreign_currency)} ${money(r.foreign_amount)}` : ''}</summary>
            <div class="row2">
              <label>Currency<input name="foreign_currency" value="${esc(r.foreign_currency)}" maxlength="6" placeholder="e.g. THB" autocapitalize="characters"></label>
              <label>Amount<input name="foreign_amount" inputmode="decimal" value="${r.foreign_amount ?? ''}"></label>
            </div>
            <div class="rate-row">
              <label>Rate to ${esc(settings.default_currency)}<input name="rate" inputmode="decimal" placeholder="e.g. 0.13"></label>
              <button type="button" class="btn ghost" data-act="convert">Fill ${esc(settings.default_currency)} amount</button>
            </div>
          </details>
          <label>Category
            <select name="category">
              <option value="">— Choose —</option>
              ${cats.map((c) => `<option ${c === r.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
            </select>
          </label>
          <div class="row2">
            <label>Area<input name="area" value="${esc(r.area)}"></label>
            <label>Payment<input name="payment_method" value="${esc(r.payment_method)}"></label>
          </div>
          <label>Notes<textarea name="notes" rows="2">${esc(r.notes)}</textarea></label>
          ${r.items?.length ? `
            <details class="items">
              <summary>${r.items.length} line item${r.items.length > 1 ? 's' : ''}</summary>
              <table>${r.items.map((i) => `<tr><td>${esc(i.item_name)}</td><td class="num">×${i.quantity ?? 1}</td><td class="num">${money(i.line_total)}</td></tr>`).join('')}</table>
            </details>` : ''}
        </div>
      </div>
      <div class="editor-actions">
        <button type="button" class="btn danger ghost" data-act="delete">Delete</button>
        <span class="spacer"></span>
        <button type="button" class="btn ghost" data-act="retry">Re-run AI</button>
        <button type="submit" class="btn primary" data-act="save">Save</button>
      </div>
    </form>`;

  const form = d.querySelector('form');
  const busy = (on) => form.querySelectorAll('button').forEach((b) => (b.disabled = on));

  form.querySelector('[data-act="convert"]').onclick = () => {
    const amount = parseFloat(form.foreign_amount.value);
    const rate = parseFloat(form.rate.value);
    if (!(amount > 0) || !(rate > 0)) { toast('Enter the foreign amount and a rate first', 'warn'); return; }
    form.total.value = (Math.round(amount * rate * 100) / 100).toFixed(2);
    form.total.focus();
  };
  form.querySelector('[data-act="close"]').onclick = () => d.close();

  form.onsubmit = async (e) => {
    e.preventDefault();
    busy(true);
    try {
      const saved = await api('/receipts/' + id, { method: 'PUT', body: JSON.stringify(formData(form)) });
      onChange(saved);
      toast(saved.status === 'ok' ? 'Saved' : saved.status === 'pending' ? 'Saved, RM amount still pending' : 'Saved, still needs: ' + saved.error, saved.status === 'ok' ? 'ok' : 'warn');
      d.close();
    } catch (err) { toast(err.message, 'bad'); busy(false); }
  };

  form.querySelector('[data-act="retry"]').onclick = async (e) => {
    busy(true);
    e.target.textContent = 'Reading…';
    try {
      const row = await api(`/receipts/${id}/retry`, { method: 'POST' });
      onChange(row);
      toast(row.status === 'failed' ? 'AI failed: ' + row.error : 'Re-read complete', row.status === 'failed' ? 'bad' : 'ok');
      openEditor(id, onChange); // re-render with the new values
    } catch (err) { toast(err.message, 'bad'); busy(false); e.target.textContent = 'Re-run AI'; }
  };

  form.querySelector('[data-act="delete"]').onclick = async () => {
    if (!confirm('Delete this receipt and its image?')) return;
    busy(true);
    try {
      await api('/receipts/' + id, { method: 'DELETE' });
      onChange({ deleted: id });
      toast('Deleted', 'ok');
      d.close();
    } catch (err) { toast(err.message, 'bad'); busy(false); }
  };
}

function formData(form) {
  const data = Object.fromEntries(new FormData(form));
  delete data.rate; // helper only, not stored
  return data;
}
