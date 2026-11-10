// Search shared by the Spending tab (in the browser) and the receipts API (all months).
//   "aeon"       -> merchant, category, area, notes, payment (every word must appear)
//   "19"         -> amounts RM 19.00–19.99, or the number in the merchant name
//   "19.50"      -> exactly that amount
//   ">100" "<20" "50-100" -> amount ranges
// "RM", "MYR" and thousands separators are ignored.

const NUM = String.raw`\d+(?:\.\d+)?`;

export function parseQuery(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const t = raw.replace(/\b(rm|myr)\b/gi, '').replace(/,/g, '').trim();

  let m;
  if ((m = t.match(new RegExp(`^>=?\\s*(${NUM})$`)))) return { kind: 'range', min: +m[1], max: Infinity, raw };
  if ((m = t.match(new RegExp(`^<=?\\s*(${NUM})$`)))) return { kind: 'range', min: 0, max: +m[1], raw };
  if ((m = t.match(new RegExp(`^(${NUM})\\s*(?:-|–|to)\\s*(${NUM})$`)))) {
    const [a, b] = [+m[1], +m[2]].sort((x, y) => x - y);
    return { kind: 'range', min: a, max: b, raw };
  }
  if ((m = t.match(/^(\d+)(?:\.(\d{1,2}))?$/))) {
    if (m[2] === undefined) return { kind: 'number', min: +m[1], max: +m[1] + 0.999, text: m[1], raw };
    const exact = Math.round(parseFloat(`${m[1]}.${m[2]}`) * 100);
    return { kind: 'number', cents: exact, text: t, raw };
  }
  return { kind: 'text', words: raw.toLowerCase().split(/\s+/).filter(Boolean), raw };
}

const amountsOf = (r) => [r.total, r.foreign_amount].filter((a) => a !== null && a !== undefined);
const haystack = (r) => [r.merchant, r.category, r.area, r.notes, r.payment_method, r.foreign_currency].filter(Boolean).join(' ').toLowerCase();

export function matches(r, q) {
  if (!q) return true;
  const amounts = amountsOf(r);
  // Ranges are about the RM amount; a plain number also matches foreign amounts
  if (q.kind === 'range') return r.total != null && r.total >= q.min - 0.0001 && r.total <= q.max + 0.0001;
  if (q.kind === 'number') {
    const byAmount = q.cents !== undefined
      ? amounts.some((a) => Math.round(a * 100) === q.cents)
      : amounts.some((a) => a >= q.min && a <= q.max);
    return byAmount || (r.merchant || '').toLowerCase().includes(q.text);
  }
  const h = haystack(r);
  return q.words.every((w) => h.includes(w));
}
