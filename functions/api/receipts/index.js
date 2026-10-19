import { json, fail, getSettings, cyclePeriod, newId } from '../../_lib/util.js';
import { processReceipt } from '../../_lib/process.js';

const ALLOWED = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
const MAX_BYTES = 10 * 1024 * 1024;

// GET /api/receipts?month=2026-09            -> receipts in that statement cycle
// GET /api/receipts?status=review,failed     -> anything needing attention
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const settings = await getSettings(env.DB);
  const month = url.searchParams.get('month');
  const status = url.searchParams.get('status');

  let rows, period = null;
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) return fail('month must be YYYY-MM');
    period = cyclePeriod(month, settings.cycle_end_day);
    ({ results: rows } = await env.DB.prepare(
      `SELECT * FROM receipts WHERE txn_date BETWEEN ? AND ? ORDER BY txn_date DESC, created_at DESC`
    ).bind(period.start, period.end).all());
  } else if (status) {
    const list = status.split(',').map((s) => s.trim()).filter(Boolean);
    ({ results: rows } = await env.DB.prepare(
      `SELECT * FROM receipts WHERE status IN (${list.map(() => '?').join(',')}) ORDER BY created_at DESC`
    ).bind(...list).all());
  } else {
    return fail('Pass month=YYYY-MM or status=...');
  }

  for (const r of rows) delete r.raw_ai;
  return json({ period, receipts: rows });
}

// POST /api/receipts  (multipart, field "file") -> stores file, runs AI, returns saved row
export async function onRequestPost({ request, env }) {
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
