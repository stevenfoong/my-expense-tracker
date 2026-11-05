import { json, fail } from '../../../_lib/util.js';
import { yearContents, deleteYearFiles, getArchiveLog, setArchiveLog } from '../../../_lib/storage.js';

const valid = (y) => /^\d{4}$/.test(y);

// GET /api/storage/:year -> records, images and statements of that year (for the download)
export async function onRequestGet({ params, env }) {
  if (!valid(params.year)) return fail('Invalid year');
  return json(await yearContents(env, params.year));
}

// DELETE /api/storage/:year -> delete that year's receipt images and statement PDFs (records stay)
export async function onRequestDelete({ params, env }) {
  if (!valid(params.year)) return fail('Invalid year');
  const result = await deleteYearFiles(env, params.year);
  const log = await getArchiveLog(env);
  delete log[params.year];
  await setArchiveLog(env, log);
  return json({ year: params.year, ...result });
}
