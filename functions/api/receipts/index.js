import { json, fail, getSettings, cyclePeriod, newId } from '../../_lib/util.js';
import { processReceipt } from '../../_lib/process.js';
import { applyEdit } from '../../_lib/edit.js';

const ALLOWED = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
const MAX_BYTES = 10 * 1024 * 1024;

// GET /api/receipts?month=2026-09            -> receipts in that statement cycle
// GET /api/receipts?status=review,failed     -> anything needing attention
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const settings = await getSettings(env.DB);
  const month = url.searchParams.get('month');
  const status = url.searchParams.get('status');
  const recent = url.searchParams.get('recent');

  let rows, period = null;
  if (recent) {
    const n = Math.min(Math.max(parseInt(recent, 10) || 10, 1), 50);
    ({ results: rows } = await env.DB.prepare(
      `SELECT * FROM receipts ORDER BY created_at DESC, rowid DESC LIMIT ?`
    ).bind(n).all());
  } else if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) return fail('month must be YYYY-MM');
    period = cyclePeriod(month, settings.cycle_end_day);
    ({ results: rows } = await env.DB.prepare(
      `SELECT * FROM receipts WHERE txn_date BETWEEN ? AND ? ORDER BY txn_date DESC, created_at DESC`
    ).bind(period.start, period.end).all());
  } else if (status) {
    // "stuck" = still "processing" after 10 minutes (the request died mid-read)
    const list = status.split(',').map((s) => s.trim()).filter((s) => s && s !== 'stuck');
    const stuck = status.split(',').includes('stuck');
    const where = [
      list.length ? `status IN (${list.map(() => '?').join(',')})` : null,
      stuck ? `(status = 'processing' AND created_at < datetime('now', '-10 minutes'))` : null,
    ].filter(Boolean).join(' OR ');
    if (!where) return fail('Unknown status filter');
    ({ results: rows } = await env.DB.prepare(
      `SELECT * FROM receipts WHERE ${where} ORDER BY created_at DESC`
    ).bind(...list).all());
  } else {
    return fail('Pass month=YYYY-MM, status=... or recent=N');
  }

  for (const r of rows) delete r.raw_ai;
  return json({ period, receipts: rows });
}

// POST /api/receipts
//   multipart, field "file"  -> stores the file, runs AI, returns the saved row
//   JSON body                 -> manual entry without a receipt image
export async function onRequestPost({ request, env }) {
  if ((request.headers.get('content-type') || '').includes('application/json')) {
    const settings = await getSettings(env.DB);
    const id = newId();
    await env.DB.prepare(
      `INSERT INTO receipts (id, status, file_key, file_type, currency) VALUES (?, 'review', '', 'manual', ?)`
    ).bind(id, settings.default_currency).run();
    const row = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id).first();
    const result = await applyEdit(env, row, await request.json());
    if (result.error) {
      await env.DB.prepare('DELETE FROM receipts WHERE id = ?').bind(id).run();
      return fail(result.error);
    }
    return json(result.row, 201);
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return fail('No file uploaded');
  if (!ALLOWED.test(file.type)) return fail('Only images and PDFs are supported');
  if (file.size > MAX_BYTES) return fail('File is larger than 10 MB');

  const id = newId();
  const ext = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1].replace('jpeg', 'jpg');
  const key = `receipts/${new Date().toISOString().slice(0, 7)}/${id}.${ext}`;

  await env.BUCKET.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  await env.DB.prepare(
    `INSERT INTO receipts (id, status, file_key, file_type, file_name) VALUES (?, 'processing', ?, ?, ?)`
  ).bind(id, key, file.type, file.name || null).run();

  const settings = await getSettings(env.DB);
  const row = await processReceipt(env, settings, id);
  delete row.raw_ai;
  return json(row, 201);
}
