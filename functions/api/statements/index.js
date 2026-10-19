import { json, fail, newId, safeParse } from '../../_lib/util.js';
import { storeParsed, loadStatement, parseRaw, periodOf } from '../../_lib/statements.js';
import { computeChecks } from '../../_lib/uob.js';

const MAX_BYTES = 10 * 1024 * 1024;

// GET /api/statements -> list with line counts and check status
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.statement_date, s.status, s.accepted, s.created_at, s.summary, s.cards, s.raw_text,
       (SELECT COUNT(*) FROM statement_lines l WHERE l.statement_id = s.id AND l.is_credit = 0) AS purchases
     FROM statements s ORDER BY s.statement_date DESC, s.created_at DESC`
  ).all();

  const out = [];
  for (const s of results) {
    const { results: lines } = await env.DB.prepare(
      'SELECT card, amount, is_credit FROM statement_lines WHERE statement_id = ?'
    ).bind(s.id).all();
    const { ok } = computeChecks({
      summary: safeParse(s.summary, null),
      cards: safeParse(s.cards, []),
      lines: lines.map((l) => ({ ...l, is_credit: Boolean(l.is_credit) })),
      rawText: s.raw_text,
    });
    out.push({
      id: s.id, statement_date: s.statement_date, period: periodOf(s.statement_date), status: s.status,
      accepted: Boolean(s.accepted), purchases: s.purchases, checks_ok: ok, created_at: s.created_at,
    });
  }
  return json({ statements: out });
}

// POST /api/statements (multipart, field "file") -> stores the PDF, reads it, returns the parsed statement
export async function onRequestPost({ request, env }) {
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return fail('No file uploaded');
  if (file.type !== 'application/pdf') return fail('Please upload the statement PDF');
  if (file.size > MAX_BYTES) return fail('File is larger than 10 MB');

  const buffer = await file.arrayBuffer();
  const [md] = await env.AI.toMarkdown([{ name: file.name || 'statement.pdf', blob: new Blob([buffer], { type: 'application/pdf' }) }]);
  const rawText = md?.data || '';
  if (rawText.replace(/^#.*$|^- \w+=.*$/gm, '').trim().length < 50) {
    return fail('No readable text in this PDF. Please upload the PDF downloaded from UOB, not a scan.');
  }

  const parsed = parseRaw(rawText);

  // Same statement uploaded again: replace the draft
  if (parsed.statement_date) {
    const existing = await env.DB.prepare('SELECT id, status, file_key FROM statements WHERE statement_date = ?')
      .bind(parsed.statement_date).first();
    if (existing) {
      if (existing.status === 'saved') return fail('This statement is already saved. Delete it first to upload it again.');
      await env.DB.batch([
        env.DB.prepare('DELETE FROM statement_lines WHERE statement_id = ?').bind(existing.id),
        env.DB.prepare('DELETE FROM statements WHERE id = ?').bind(existing.id),
      ]);
      await env.BUCKET.delete(existing.file_key);
    }
  }

  const id = newId();
  const key = `statements/${parsed.statement_date || 'undated'}-${id}.pdf`;
  await env.BUCKET.put(key, buffer, { httpMetadata: { contentType: 'application/pdf' } });
  await env.DB.prepare(
    `INSERT INTO statements (id, file_key, file_name, raw_text) VALUES (?, ?, ?, ?)`
  ).bind(id, key, file.name || null, rawText).run();
  await storeParsed(env, id, parsed);

  return json(await loadStatement(env, id), 201);
}
