import { json, fail, getSettings, cyclePeriod, cycleMonthOf, shiftMonth, todayLocal, canonCurrency as canon } from '../_lib/util.js';

// GET /api/trends?range=year|12m
// Monthly totals by statement cycle, in the default currency.
export async function onRequestGet({ request, env }) {
  const range = new URL(request.url).searchParams.get('range') || '12m';
  if (!['year', '12m'].includes(range)) return fail('range must be year or 12m');

  const settings = await getSettings(env.DB);
  const endDay = settings.cycle_end_day;
  const current = cycleMonthOf(todayLocal(), endDay);

  const first = range === 'year' ? `${current.slice(0, 4)}-01` : shiftMonth(current, -11);
  const monthKeys = [];
  for (let m = first; m <= current; m = shiftMonth(m, 1)) monthKeys.push(m);

  const start = cyclePeriod(first, endDay).start;
  const end = cyclePeriod(current, endDay).end;

  const { results } = await env.DB.prepare(
    `SELECT txn_date, total, currency, category, foreign_currency, foreign_amount FROM receipts
     WHERE txn_date BETWEEN ? AND ? AND (total IS NOT NULL OR foreign_amount IS NOT NULL)`
  ).bind(start, end).all();

  const main = canon(settings.default_currency);
  const months = Object.fromEntries(monthKeys.map((k) => [k, { month: k, ...cyclePeriod(k, endDay), total: 0, count: 0 }]));
  const pending = {};
  const cats = {};

  for (const r of results) {
    const key = cycleMonthOf(r.txn_date, endDay);
    if (!months[key]) continue;
    if (r.total === null) {
      // Foreign amount recorded, RM amount not filled in yet
      const c = r.foreign_currency || '?';
      pending[c] = pending[c] || { currency: c, total: 0, count: 0 };
      pending[c].total += r.foreign_amount;
      pending[c].count += 1;
      continue;
    }
    const cur = canon(r.currency) || main;
    if (cur === main) {
      months[key].total += r.total;
      months[key].count += 1;
      const c = r.category || 'Uncategorised';
      cats[c] = (cats[c] || 0) + r.total;
    }
  }

  const list = monthKeys.map((k) => ({ ...months[k], total: Math.round(months[k].total * 100) / 100 }));
  const total = list.reduce((s, m) => s + m.total, 0);
  const highest = list.reduce((best, m) => (m.total > (best?.total ?? -1) ? m : best), null);

  return json({
    range,
    currency: settings.default_currency,
    current_month: current,
    months: list,
    total: Math.round(total * 100) / 100,
    average: Math.round((total / list.length) * 100) / 100,
    highest: highest && highest.total > 0 ? { month: highest.month, total: highest.total } : null,
    pending_conversion: Object.values(pending).map((p) => ({ ...p, total: Math.round(p.total * 100) / 100 })),
    categories: Object.entries(cats)
      .map(([category, t]) => ({ category, total: Math.round(t * 100) / 100 }))
      .sort((a, b) => b.total - a.total),
  });
}
