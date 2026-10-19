// GET /api/statements/:id/file -> the original statement PDF
export async function onRequestGet({ params, env }) {
  const s = await env.DB.prepare('SELECT file_key FROM statements WHERE id = ?').bind(params.id).first();
  if (!s) return new Response('Not found', { status: 404 });
  const obj = await env.BUCKET.get(s.file_key);
  if (!obj) return new Response('File missing', { status: 404 });
  return new Response(obj.body, { headers: { 'content-type': 'application/pdf', 'cache-control': 'private, max-age=3600' } });
}
