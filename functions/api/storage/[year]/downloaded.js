import { json, fail } from '../../../_lib/util.js';
import { getArchiveLog, setArchiveLog } from '../../../_lib/storage.js';

// POST /api/storage/:year/downloaded -> remember that this year was downloaded (now)
export async function onRequestPost({ params, env }) {
  if (!/^\d{4}$/.test(params.year)) return fail('Invalid year');
  const log = await getArchiveLog(env);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19); // same format as created_at
  log[params.year] = now;
  await setArchiveLog(env, log);
  return json({ year: params.year, downloaded_at: now });
}
