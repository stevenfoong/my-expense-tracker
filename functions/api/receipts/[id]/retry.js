import { json, fail, getSettings } from '../../../_lib/util.js';
import { processReceipt } from '../../../_lib/process.js';

// POST /api/receipts/:id/retry -> re-run AI extraction on the stored file
export async function onRequestPost({ params, env }) {
  const r = await env.DB.prepare('SELECT file_key FROM receipts WHERE id = ?').bind(params.id).first();
  if (!r) return fail('Not found', 404);
  if (!r.file_key) return fail('This entry has no receipt image for the AI to read');
  const settings = await getSettings(env.DB);
  const row = await processReceipt(env, settings, params.id);
  delete row.raw_ai;
  return json(row);
}
