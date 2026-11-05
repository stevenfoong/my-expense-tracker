import { json } from '../../_lib/util.js';
import { usage } from '../../_lib/storage.js';

// GET /api/storage -> R2 and D1 usage with a per-year breakdown
export async function onRequestGet({ env }) {
  return json(await usage(env));
}
