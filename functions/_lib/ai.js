import { toBase64, normaliseDate, toNumber } from './util.js';

function buildPrompt(settings) {
  return `You are reading a purchase receipt. Extract the details and return ONLY a JSON object:
{
  "merchantName": "store or vendor name",
  "date": "transaction date as YYYY-MM-DD",
  "totalAmount": 0.00,
  "currency": "currency code or symbol as printed, e.g. RM, SGD, THB. Empty if not shown",
  "category": "one of the allowed categories, or empty if none fits",
  "area": "town / area / city from the merchant address, empty if not shown",
  "paymentMethod": "e.g. Cash, Visa, Mastercard, Debit, E-wallet. Empty if not shown",
  "lineItems": [ { "itemName": "item", "quantity": 1, "lineTotal": 0.00 } ]
}

Rules:
- totalAmount is the final amount paid (after tax, service charge, rounding and discounts), as a number.
- Receipts are usually from Malaysia; dates are normally printed day-first (DD/MM/YYYY).
- quantity is a number; use 1 when not shown. lineTotal is the amount charged for that line.
- Allowed categories: ${JSON.stringify(settings.categories)}. Use an exact value from this list or "".
- Do not guess values that are not on the receipt; use "" instead.`;
}

/**
 * Calls Ollama /api/chat through Cloudflare Access and returns the parsed JSON content.
 * - Streams the reply, so the connection through the tunnel stays alive on slow hardware
 *   (Cloudflare drops requests that send nothing back for ~100 seconds).
 * - Turns off "thinking" so the model answers directly instead of reasoning first.
 */
export async function callOllama(env, settings, message) {
  if (!settings.ai_url) throw new Error('AI URL is not set (Settings tab)');

  const send = (withThinkFlag) => fetch(settings.ai_url + '/api/chat', {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(5 * 60 * 1000),
    headers: {
      'content-type': 'application/json',
      'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID || '',
      'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET || '',
    },
    body: JSON.stringify({
      model: settings.ai_model,
      stream: true,
      format: 'json',
      keep_alive: '30m',
      ...(withThinkFlag ? { think: false } : {}),
      options: { temperature: 0, num_predict: 1500 },
      messages: [message],
    }),
  });

  let res = await send(true);
  if (res.status === 400) {
    // Models without a thinking mode reject the flag: retry without it.
    const body = await res.text();
    if (/think/i.test(body)) res = await send(false);
    else throw new Error(`AI request failed (400): ${body.slice(0, 300)}`);
  }
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`AI blocked by Cloudflare Access (${res.status}). Check the service token secrets and the Service Auth policy.`);
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`AI request failed (${res.status}): ${body}`);
  }

  // Read the NDJSON stream and join the content pieces.
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '', content = '', doneReason = '';
  const handle = (line) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line);
    if (chunk.error) throw new Error('AI error: ' + chunk.error);
    if (chunk.message?.content) content += chunk.message.content;
    if (chunk.done) doneReason = chunk.done_reason || 'stop';
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    lines.forEach(handle);
  }
  handle(buffer);

  try {
    return JSON.parse(content);
  } catch {
    if (doneReason === 'length') throw new Error('AI answer was cut off (too long). Try Re-run AI, or a clearer photo.');
    throw new Error('AI did not return valid JSON');
  }
}

/** PDF -> text via Workers AI toMarkdown (reads the PDF text layer). */
async function pdfToText(env, buffer, name) {
  const [result] = await env.AI.toMarkdown([
    { name: name || 'receipt.pdf', blob: new Blob([buffer], { type: 'application/pdf' }) },
  ]);
  return (result && result.data) || '';
}

/** Runs extraction for one stored file. Returns { fields, items, status, error, raw }. */
export async function extractReceipt(env, settings, buffer, mimeType, fileName) {
  const prompt = buildPrompt(settings);
  let message;

  if (mimeType === 'application/pdf') {
    const text = await pdfToText(env, buffer, fileName);
    const body = text.replace(/^#.*$|^- \w+=.*$/gm, '').trim(); // drop metadata lines
    if (body.length < 20) {
      throw new Error('PDF has no readable text (probably a scanned PDF). Upload a photo or screenshot instead.');
    }
    message = { role: 'user', content: `${prompt}\n\nReceipt text:\n"""\n${text}\n"""` };
  } else if (mimeType.startsWith('image/')) {
    message = { role: 'user', content: prompt, images: [toBase64(buffer)] };
  } else {
    throw new Error('Unsupported file type: ' + mimeType);
  }

  const raw = await callOllama(env, settings, message);
  return validate(raw, settings);
}

function validate(raw, settings) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '') || null;
  const problems = [];

  const fields = {
    merchant: str(raw.merchantName),
    txn_date: normaliseDate(raw.date),
    total: toNumber(raw.totalAmount),
    currency: str(raw.currency) || settings.default_currency,
    category: str(raw.category),
    area: str(raw.area),
    payment_method: str(raw.paymentMethod),
  };

  if (fields.category && !settings.categories.includes(fields.category)) fields.category = null;

  if (!fields.merchant) problems.push('merchant missing');
  if (!fields.txn_date) problems.push('date missing or unreadable');
  if (fields.total === null) problems.push('total missing');
  if (!fields.category) problems.push('category not set');

  const items = Array.isArray(raw.lineItems)
    ? raw.lineItems
        .filter((i) => i && str(i.itemName))
        .map((i) => ({
          item_name: str(i.itemName),
          quantity: toNumber(i.quantity) ?? 1,
          line_total: toNumber(i.lineTotal),
        }))
    : [];

  return {
    fields,
    items,
    status: problems.length ? 'review' : 'ok',
    error: problems.length ? problems.join(', ') : null,
    raw,
  };
}
