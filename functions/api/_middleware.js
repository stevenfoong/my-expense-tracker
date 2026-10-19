// Extra lock on the API: verifies the Cloudflare Access JWT when
// ACCESS_TEAM_DOMAIN and ACCESS_AUD are set. Without them, it relies on
// Access in front of the site (still required).

let certCache = { keys: null, at: 0 };

async function getKeys(teamDomain) {
  if (certCache.keys && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  const { keys } = await res.json();
  certCache = { keys, at: Date.now() };
  return keys;
}

const b64urlToBytes = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

async function verifyAccessJwt(token, teamDomain, aud) {
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return false;
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));

  const jwk = (await getKeys(teamDomain)).find((k) => k.kid === header.kid);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return false;

  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  return auds.includes(aud) && payload.exp * 1000 > Date.now();
}

export async function onRequest(context) {
  const { request, env, next } = context;
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    let ok = false;
    try { ok = token && (await verifyAccessJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD)); } catch {}
    if (!ok) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  try {
    return await next();
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
