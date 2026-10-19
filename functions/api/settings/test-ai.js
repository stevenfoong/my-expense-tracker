import { json, getSettings } from '../../_lib/util.js';

// POST /api/settings/test-ai -> checks the tunnel + Access token + model availability
export async function onRequestPost({ env }) {
  const s = await getSettings(env.DB);
  if (!s.ai_url) return json({ ok: false, message: 'AI URL is not set' });

  try {
    const res = await fetch(s.ai_url + '/api/tags', {
      redirect: 'manual',
      headers: {
        'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID || '',
        'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET || '',
      },
    });
    if (res.status >= 300 && res.status < 400) {
      return json({ ok: false, message: `Blocked by Cloudflare Access (${res.status}). Check the service token and Service Auth policy.` });
    }
    if (!res.ok) return json({ ok: false, message: `AI server returned ${res.status}` });
    const { models = [] } = await res.json();
    const names = models.map((m) => m.name);
    const found = names.includes(s.ai_model);
    return json({
      ok: found,
      message: found ? `Connected. Model ${s.ai_model} is available.` : `Connected, but model ${s.ai_model} was not found. Available: ${names.join(', ') || 'none'}`,
    });
  } catch (e) {
    return json({ ok: false, message: 'Could not reach AI URL: ' + (e.message || e) });
  }
}
