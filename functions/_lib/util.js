export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

export const fail = (message, status = 400) => json({ error: message }, status);

export async function getSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    cycle_end_day: parseInt(s.cycle_end_day || '25', 10),
    ai_url: (s.ai_url || '').replace(/\/+$/, ''),
    ai_model: s.ai_model || 'gemma4:e4b',
    default_currency: s.default_currency || 'RM',
    categories: safeParse(s.categories, []),
  };
}

export function safeParse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * Statement period for a month label.
 * endDay 25, "2026-09" -> 2026-08-26 .. 2026-09-25
 * If endDay is past the month's last day, the month's last day is used.
 */
export function cyclePeriod(month, endDay) {
  const [y, m] = month.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1, Math.min(endDay, lastDay(y, m))));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const start = new Date(Date.UTC(py, pm - 1, Math.min(endDay, lastDay(py, pm)) + 1));
  return { start: fmt(start), end: fmt(end) };
}

export function newId() {
  return crypto.randomUUID();
}

export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Accepts YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY. Returns YYYY-MM-DD or null. */
export function normaliseDate(value) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim();
  let y, m, d;
  let r = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (r) [, y, m, d] = r;
  else if ((r = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
    [, d, m, y] = r;
    if (y.length === 2) y = '20' + y;
  } else return null;
  y = +y; m = +m; d = +d;
  if (m < 1 || m > 12 || d < 1 || d > lastDay(y, m)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const n = parseFloat(value.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
