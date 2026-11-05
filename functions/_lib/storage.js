// Storage usage and per-year archive helpers.
import { safeParse } from './util.js';

export const R2_FREE_BYTES = 10 * 1024 ** 3;   // R2 free tier: 10 GB-month
export const D1_MAX_BYTES = 500 * 1024 ** 2;   // D1 free plan: 500 MB per database

const RECEIPT_YEAR = `strftime('%Y', COALESCE(txn_date, created_at))`;
const STATEMENT_YEAR = `strftime('%Y', COALESCE(statement_date, created_at))`;

/** All objects in the bucket: Map(key -> size). */
export async function listBucket(env) {
  const sizes = new Map();
  let cursor;
  do {
    const page = await env.BUCKET.list({ cursor, limit: 1000 });
    for (const o of page.objects) sizes.set(o.key, o.size);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return sizes;
}

export async function getArchiveLog(env) {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'archive_downloads'`).first();
  return safeParse(row?.value, {}) || {};
}

export async function setArchiveLog(env, log) {
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('archive_downloads', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(JSON.stringify(log)).run();
}

/** Usage summary with a per-year breakdown. */
export async function usage(env) {
  const sizes = await listBucket(env);
  const probe = await env.DB.prepare('SELECT 1').run();
  const d1Bytes = probe.meta?.size_after ?? null;

  const { results: receipts } = await env.DB.prepare(
    `SELECT ${RECEIPT_YEAR} AS year, file_key, created_at FROM receipts`
  ).all();
  const { results: statements } = await env.DB.prepare(
    `SELECT ${STATEMENT_YEAR} AS year, file_key FROM statements`
  ).all();
  const log = await getArchiveLog(env);

  const years = {};
  const y = (k) => (years[k] ??= { year: k, records: 0, images: 0, image_bytes: 0, statements: 0, statement_bytes: 0, added_since_download: 0 });
  const known = new Set();
  for (const r of receipts) {
    const e = y(r.year);
    e.records++;
    if (r.file_key && sizes.has(r.file_key)) { e.images++; e.image_bytes += sizes.get(r.file_key); known.add(r.file_key); }
    if (log[r.year] && r.file_key && r.created_at > log[r.year]) e.added_since_download++;
  }
  for (const s of statements) {
    if (s.file_key && sizes.has(s.file_key)) { const e = y(s.year); e.statements++; e.statement_bytes += sizes.get(s.file_key); known.add(s.file_key); }
  }

  let other = { objects: 0, bytes: 0 };
  for (const [k, v] of sizes) if (!known.has(k)) { other.objects++; other.bytes += v; }
  const r2Bytes = [...sizes.values()].reduce((a, b) => a + b, 0);

  return {
    r2: { bytes: r2Bytes, objects: sizes.size, limit: R2_FREE_BYTES },
    d1: { bytes: d1Bytes, limit: D1_MAX_BYTES },
    years: Object.values(years)
      .map((e) => ({ ...e, bytes: e.image_bytes + e.statement_bytes, downloaded_at: log[e.year] || null }))
      .sort((a, b) => b.year.localeCompare(a.year)),
    other,
  };
}

/** Everything belonging to a year, for the download. */
export async function yearContents(env, year) {
  const sizes = await listBucket(env);
  const { results: receipts } = await env.DB.prepare(
    `SELECT id, txn_date, created_at, merchant, total, currency, foreign_currency, foreign_amount, category, area,
       payment_method, status, notes, file_key, file_type, file_name, statement_line_id
     FROM receipts WHERE ${RECEIPT_YEAR} = ? ORDER BY txn_date, created_at`
  ).bind(year).all();
  const { results: statements } = await env.DB.prepare(
    `SELECT id, statement_date, file_key FROM statements WHERE ${STATEMENT_YEAR} = ? ORDER BY statement_date`
  ).bind(year).all();
  return {
    year,
    receipts: receipts.map((r) => ({ ...r, has_file: Boolean(r.file_key && sizes.has(r.file_key)), size: sizes.get(r.file_key) || 0 })),
    statements: statements.map((s) => ({ ...s, has_file: Boolean(s.file_key && sizes.has(s.file_key)), size: sizes.get(s.file_key) || 0 })),
  };
}

/** Deletes a year's receipt images and statement PDFs. Records stay. */
export async function deleteYearFiles(env, year) {
  const c = await yearContents(env, year);
  const keys = [...c.receipts.filter((r) => r.file_key), ...c.statements.filter((s) => s.file_key)].map((x) => x.file_key);
  for (let i = 0; i < keys.length; i += 1000) await env.BUCKET.delete(keys.slice(i, i + 1000));

  const stmts = [
    ...c.receipts.filter((r) => r.file_key).map((r) =>
      env.DB.prepare(`UPDATE receipts SET file_key = '', notes = COALESCE(notes || ' · ', '') || 'Image archived', updated_at = datetime('now') WHERE id = ?`).bind(r.id)),
    ...c.statements.filter((s) => s.file_key).map((s) =>
      env.DB.prepare(`UPDATE statements SET file_key = '', updated_at = datetime('now') WHERE id = ?`).bind(s.id)),
  ];
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  const bytes = [...c.receipts, ...c.statements].reduce((t, x) => t + (x.has_file ? x.size : 0), 0);
  return { files: keys.length, bytes };
}
