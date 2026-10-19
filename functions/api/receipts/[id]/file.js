// GET /api/receipts/:id/file -> the original receipt image / PDF from R2
export async function onRequestGet({ params, env }) {
  const row = await env.DB.prepare('SELECT file_key, file_type FROM receipts WHERE id = ?').bind(params.id).first();
  if (!row || !row.file_key) return new Response('Not found', { status: 404 });
  const obj = await env.BUCKET.get(row.file_key);
  if (!obj) return new Response('File missing', { status: 404 });
  return new Response(obj.body, {
    headers: { 'content-type': row.file_type, 'cache-control': 'private, max-age=86400' },
  });
}
