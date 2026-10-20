import { json, fail, getSettings } from '../_lib/util.js';

// GET /api/settings
export async function onRequestGet({ env }) {
  const s = await getSettings(env.DB);
  return json({ ...s, ai_token_configured: Boolean(env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) });
}

// PUT /api/settings
export async function onRequestPut({ request, env }) {
  const b = await request.json();
  const updates = {};

  if ('cycle_end_day' in b) {
    const d = parseInt(b.cycle_end_day, 10);
    if (!(d >= 1 && d <= 31)) return fail('Statement end day must be 1-31');
    updates.cycle_end_day = String(d);
  }
  if ('ai_url' in b) {
    const u = String(b.ai_url || '').trim().replace(/\/+$/, '');
    if (u && !/^https:\/\//.test(u)) return fail('AI URL must start with https://');
    updates.ai_url = u;
  }
  if ('ai_model' in b) updates.ai_model = String(b.ai_model || '').trim() || 'gemma4:e4b';
  if ('default_currency' in b) updates.default_currency = String(b.default_currency || '').trim() || 'RM';
  if ('categories' in b) {
    if (!Array.isArray(b.categories)) return fail('categories must be a list');
    const list = [...new Set(b.categories.map((c) => String(c).trim()).filter(Boolean))];
    updates.categories = JSON.stringify(list);
  }

  if ('card_modes' in b) {
    const modes = {};
    for (const [card, mode] of Object.entries(b.card_modes || {})) {
      if (!/^\d{4}$/.test(card) || !['match', 'record', 'skip'].includes(mode)) return fail('Invalid card mode');
      modes[card] = mode;
    }
    const current = (await getSettings(env.DB)).card_modes;
    updates.card_modes = JSON.stringify({ ...current, ...modes });
  }

  await env.DB.batch(
    Object.entries(updates).map(([k, v]) =>
      env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v)
    )
  );
  return onRequestGet({ env });
}
