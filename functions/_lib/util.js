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

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/**
 * Parses a date exactly as printed on a receipt. Day-first for numeric dates
 * (Malaysian receipts), month names in either order, 2-digit years as 20YY.
 * Ignores any time part. Returns YYYY-MM-DD or null.
 */
export function parsePrintedDate(value) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim().toLowerCase().replace(/\s+/g, ' ');

  // Numeric: YYYY-MM-DD first, otherwise DD/MM/YY(YY)
  let r = v.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/) || null;
  if (r) return normaliseDate(`${r[1]}-${r[2]}-${r[3]}`);
  r = v.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (r) return normaliseDate(`${r[1]}/${r[2]}/${r[3]}`);

  // Month names: "03 Sep 2026", "3-SEP-26", "Sep 3, 2026"
  const monthNo = (word) => MONTHS[word.slice(0, 4)] ?? MONTHS[word.slice(0, 3)];
  r = v.match(/\b(\d{1,2})(?:st|nd|rd|th)?[ \-/.]?([a-z]{3,9})[ \-/.,]*(\d{2,4})\b/);
  if (r && monthNo(r[2])) return normaliseDate(`${r[1]}/${monthNo(r[2])}/${r[3]}`);
  r = v.match(/\b([a-z]{3,9})[ \-/.]?(\d{1,2})(?:st|nd|rd|th)?[ \-/.,]*(\d{2,4})\b/);
  if (r && monthNo(r[1])) return normaliseDate(`${r[2]}/${monthNo(r[1])}/${r[3]}`);
  return null;
}

/** Today's date in Malaysia/Singapore time (UTC+8) as YYYY-MM-DD. */
export function todayLocal() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400_000;

/**
 * Receipts are uploaded soon after purchase. If the year looks misread (date in the
 * future, or over a year old) and the same day/month in the current or previous year
 * is within the last 120 days, use that year. Returns { date, note }.
 */
export function sanityCheckYear(date, today = todayLocal()) {
  if (!date) return { date, note: null };
  const age = daysBetween(date, today);
  if (age >= -1 && age <= 366) return { date, note: null };

  const [, m, d] = date.split('-');
  const ty = Number(today.slice(0, 4));
  for (const y of [ty, ty - 1]) {
    const candidate = normaliseDate(`${y}-${m}-${d}`);
    if (!candidate) continue;
    const a = daysBetween(candidate, today);
    if (a >= -1 && a <= 120) return { date: candidate, note: `Year read as ${date.slice(0, 4)}, corrected to ${y}` };
  }
  return { date, note: 'date looks wrong (far from upload date)' };
}

/** Statement month (YYYY-MM) a date falls into, given the cycle end day. */
export function cycleMonthOf(date, endDay) {
  let [y, m, d] = date.split('-').map(Number);
  if (d > Math.min(endDay, lastDay(y, m))) { m += 1; if (m > 12) { m = 1; y += 1; } }
  return `${y}-${pad(m)}`;
}

/** Shift a YYYY-MM month by n months. */
export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

/** Normalise a currency label so "RM", "MYR", "rm" compare equal. */
export function canonCurrency(c) {
  const u = String(c || '').trim().toUpperCase().replace(/\.$/, '');
  return { MYR: 'RM', RINGGIT: 'RM' }[u] || u;
}
