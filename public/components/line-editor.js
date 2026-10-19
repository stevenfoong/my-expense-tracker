// Small dialog to edit, add or delete a statement line.
import { api, esc, toast } from '../lib.js';

let dialog;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'editor narrow';
  document.body.append(dialog);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  return dialog;
}

/** onChange(updatedStatement) is called after a save or delete. */
export function openLineEditor({ statement, card, line, onChange }) {
  const d = ensureDialog();
  const isNew = !line;
  const l = line || { txn_date: statement.period?.end || '', merchant: '', location: '', amount: '', is_credit: false };

  d.innerHTML = `
    <form class="editor-body">
      <div class="editor-head">
        <h2>${isNew ? `Add line to **${esc(card)}` : 'Edit line'}</h2>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close">✕</button>
      </div>
      ${!isNew && l.description && l.description !== [l.merchant, l.location].filter(Boolean).join(' ')
        ? `<p class="muted small">Read from PDF: ${esc(l.description)}</p>` : ''}
      <div class="row2">
        <label>Date<input type="date" name="txn_date" value="${esc(l.txn_date)}" required></label>
        <label>Amount (RM)<input name="amount" inputmode="decimal" value="${l.amount ?? ''}" required></label>
      </div>
      <label>Description<input name="merchant" value="${esc(l.merchant)}" required autocapitalize="characters"></label>
      <label>Location<input name="location" value="${esc(l.location)}" autocapitalize="characters"></label>
      <div class="row2">
        <label>Foreign currency<input name="foreign_currency" value="${esc(l.foreign_currency)}" maxlength="3" placeholder="e.g. USD" autocapitalize="characters"></label>
        <label>Foreign amount<input name="foreign_amount" inputmode="decimal" value="${l.foreign_amount ?? ''}"></label>
      </div>
      <label class="check"><input type="checkbox" name="is_credit" ${l.is_credit ? 'checked' : ''}> Credit (payment or refund, shown as CR)</label>
      <div class="editor-actions">
        ${isNew ? '' : '<button type="button" class="btn danger ghost" data-act="delete">Delete line</button>'}
        <span class="spacer"></span>
        <button type="submit" class="btn primary">${isNew ? 'Add' : 'Save'}</button>
      </div>
    </form>`;
  if (!d.open) d.showModal();

  const form = d.querySelector('form');
  const busy = (on) => form.querySelectorAll('button').forEach((b) => (b.disabled = on));
  form.querySelector('[data-act="close"]').onclick = () => d.close();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.is_credit = form.is_credit.checked;
    busy(true);
    try {
      const updated = isNew
        ? await api(`/statements/${statement.id}/lines`, { method: 'POST', body: JSON.stringify({ ...data, card }) })
        : await api(`/statements/${statement.id}/lines/${l.id}`, { method: 'PUT', body: JSON.stringify(data) });
      d.close();
      onChange(updated);
      toast(isNew ? 'Line added' : 'Line saved', 'ok');
    } catch (err) { toast(err.message, 'bad'); busy(false); }
  };

  const del = form.querySelector('[data-act="delete"]');
  if (del) del.onclick = async () => {
    if (!confirm('Delete this line?')) return;
    busy(true);
    try {
      const updated = await api(`/statements/${statement.id}/lines/${l.id}`, { method: 'DELETE' });
      d.close();
      onChange(updated);
      toast('Line deleted', 'ok');
    } catch (err) { toast(err.message, 'bad'); busy(false); }
  };
}
