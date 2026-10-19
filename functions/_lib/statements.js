import { parseUobStatement, computeChecks } from './uob.js';
import { cyclePeriod, safeParse } from './util.js';

const AMOUNT_IN_TEXT = /(?:\d{1,3}(?:,\d{3})+|\d+)?\.\d{2}\b/;

/** Statement period: day after the previous statement date up to the statement date. */
export function periodOf(statementDate) {
  if (!statementDate) return null;
  return cyclePeriod(statementDate.slice(0, 7), +statementDate.slice(8, 10));
}

/** Writes parsed cards/lines for a statement, replacing any existing lines. */
export async function storeParsed(env, id, parsed) {
  const cards = parsed.cards.map(({ lines, ...c }) => c);
  const stmts = [
    env.DB.prepare(
      `UPDATE statements SET statement_date = ?, summary = ?, cards = ?, warnings = ?, accepted = 0,
         updated_at = datetime('now') WHERE id = ?`
    ).bind(parsed.statement_date, JSON.stringify(parsed.summary), JSON.stringify(cards), JSON.stringify(parsed.warnings), id),
    env.DB.prepare('DELETE FROM statement_lines WHERE statement_id = ?').bind(id),
  ];
  let n = 0;
  for (const c of parsed.cards) {
    for (const l of c.lines) {
      stmts.push(env.DB.prepare(
        `INSERT INTO statement_lines (statement_id, card, line_no, txn_date, description, merchant, location, country,
           amount, is_credit, kind, foreign_currency, foreign_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, c.last4, ++n, l.txn_date, l.description, l.merchant, l.location, l.country, l.amount,
        l.is_credit ? 1 : 0, l.kind, l.foreign_currency, l.foreign_amount));
    }
  }
  await env.DB.batch(stmts);
}

/** Full statement for the UI: header, cards, lines and checks. */
export async function loadStatement(env, id) {
  const s = await env.DB.prepare('SELECT * FROM statements WHERE id = ?').bind(id).first();
  if (!s) return null;
  const { results: rows } = await env.DB.prepare(
    'SELECT * FROM statement_lines WHERE statement_id = ? ORDER BY line_no, id'
  ).bind(id).all();

  const lines = rows.map((l) => ({
    ...l,
    is_credit: Boolean(l.is_credit),
    manual: Boolean(l.manual),
    // A description holding an amount, or very long, usually means two lines were merged
    suspect: !l.manual && (AMOUNT_IN_TEXT.test(l.description || '') || (l.description || '').length > 60 || !l.txn_date),
  }));
  const summary = safeParse(s.summary, null);
  const cards = safeParse(s.cards, []);
  const { checks, ok } = computeChecks({ summary, cards, lines, rawText: s.raw_text });

  return {
    id: s.id,
    created_at: s.created_at,
    statement_date: s.statement_date,
    period: periodOf(s.statement_date),
    file_name: s.file_name,
    status: s.status,
    accepted: Boolean(s.accepted),
    summary,
    cards,
    warnings: safeParse(s.warnings, []),
    lines,
    checks,
    checks_ok: ok,
    raw_text: s.raw_text,
  };
}

export function parseRaw(rawText) {
  return parseUobStatement(rawText);
}
