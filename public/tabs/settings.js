import { api, esc, toast, getSettings, setSettingsCache } from '../lib.js';

let el;

function mount(root) {
  el = root;
  el.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>';
}

async function show() {
  let s;
  try { s = await getSettings(true); } catch (e) { toast(e.message, 'bad'); return; }

  el.innerHTML = `
    <form class="card settings" id="settings-form">
      <h2>Statement</h2>
      <label>Statement end day
        <input type="number" name="cycle_end_day" min="1" max="31" value="${s.cycle_end_day}" required>
        <small class="muted">With 25, “Sep” covers 26 Aug – 25 Sep. Use 31 for calendar months.</small>
      </label>
      <label>Default currency
        <input name="default_currency" value="${esc(s.default_currency)}" maxlength="6" required>
      </label>

      <h2>AI</h2>
      <label>AI URL
        <input type="url" name="ai_url" value="${esc(s.ai_url)}" placeholder="https://ai.yourdomain.com">
        <small class="muted">Your Ollama hostname behind the Cloudflare Tunnel.</small>
      </label>
      <label>Model
        <input name="ai_model" value="${esc(s.ai_model)}" required>
      </label>
      <p class="muted small">Access service token:
        ${s.ai_token_configured ? '<span class="ok-text">configured</span>' : '<span class="bad-text">not set (add CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET as secrets in the Pages project)</span>'}
      </p>
      <div class="inline-actions">
        <button type="button" class="btn ghost" id="test-ai">Test connection</button>
        <span class="muted small" id="test-result"></span>
      </div>

      <h2>Categories</h2>
      <label>One per line
        <textarea name="categories" rows="10">${esc(s.categories.join('\n'))}</textarea>
        <small class="muted">The AI picks from this list. If nothing fits, the receipt is flagged for you to choose.</small>
      </label>

      <div class="form-actions"><button class="btn primary" type="submit">Save settings</button></div>
    </form>`;

  const form = el.querySelector('#settings-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.categories = data.categories.split('\n').map((c) => c.trim()).filter(Boolean);
    try {
      setSettingsCache(await api('/settings', { method: 'PUT', body: JSON.stringify(data) }));
      toast('Settings saved', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  };

  el.querySelector('#test-ai').onclick = async (e) => {
    const out = el.querySelector('#test-result');
    e.target.disabled = true;
    out.textContent = 'Testing… (save first if you changed the URL)';
    try {
      const r = await api('/settings/test-ai', { method: 'POST' });
      out.innerHTML = `<span class="${r.ok ? 'ok-text' : 'bad-text'}">${esc(r.message)}</span>`;
    } catch (err) { out.innerHTML = `<span class="bad-text">${esc(err.message)}</span>`; }
    e.target.disabled = false;
  };
}

export default { mount, show };
