import { json, getSettings } from '../../../_lib/util.js';
import { processReceipt } from '../../../_lib/process.js';

// POST /api/receipts/:id/retry -> re-run AI extraction on the stored file
export async function onRequestPost({ params, env }) {
  const settings = await getSettings(env.DB);
  const row = await processReceipt(env, settings, params.id);
  delete row.raw_ai;
  return json(row);
}
