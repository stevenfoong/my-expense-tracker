// Parser for UOB Malaysia credit card statements (text from Workers AI toMarkdown).
// Works on the text as a stream, so it does not depend on how lines are broken.

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MON = MONTHS.join('|');
const AMT = String.raw`((?:\d{1,3}(?:,\d{3})+|\d+)?\.\d{2})`;
const SEP = '[ ¦]*';
const PAGE = '⟦P⟧';

const KNOWN_PLACES = [
  'W P KUALA LUM', 'WP KUALA LUMPUR', 'KUALA LUMPUR', 'PETALING JAYA', 'SUBANG JAYA', 'SHAH ALAM', 'SERI KEMBANGAN',
  'GEORGE TOWN', 'JOHOR BAHRU', 'KOTA KINABALU', 'SAN FRANCISCO', 'PULAU PINANG', 'NEGERI SEMBILAN', 'KUALA TERENGGANU',
  'SELANGOR', 'PUCHONG', 'CYBERJAYA', 'PUTRAJAYA', 'KLANG', 'SEPANG', 'KAJANG', 'CHERAS', 'AMPANG', 'RAWANG', 'SEMENYIH',
  'DAMANSARA', 'PENANG', 'IPOH', 'MELAKA', 'SEREMBAN', 'KUANTAN', 'KUCHING', 'MIRI', 'JOHOR', 'PERAK', 'KEDAH', 'PAHANG',
  'SABAH', 'SARAWAK', 'SINGAPORE', 'BANGKOK', 'HONG KONG', 'LONDON', 'DUBLIN', 'SEATTLE', 'MOUNTAIN VIEW', 'SUNNYVALE',
  'LUXEMBOURG', 'AMSTERDAM', 'TOKYO', 'SEOUL', 'TAIPEI', 'SHANGHAI', 'SHENZHEN', 'BEIJING', 'SYDNEY', 'MELBOURNE',
].sort((a, b) => b.length - a.length);

export const toAmount = (s) => (s == null ? null : Math.round(parseFloat(String(s).replace(/,/g, '')) * 100) / 100);
const pad = (n) => String(n).padStart(2, '0');

function isoDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Normalise one page: uppercase, mark wide gaps (likely column breaks) with ¦, single spaces. */
function normalise(text) {
  return text
    .toUpperCase()
    .replace(/\r/g, '')
    .replace(/[ \t]{2,}/g, ' ¦ ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

function splitPages(markdown) {
  let body = markdown;
  const contents = body.search(/^#+\s*CONTENTS\s*$/im);
  if (contents >= 0) body = body.slice(contents).replace(/^#+\s*CONTENTS\s*$/im, '');
  let pages = body.split(/^#{1,6}\s*PAGE\s+\d+\s*$/im).map((p) => p.trim()).filter(Boolean);
  if (pages.length <= 1) {
    // No page headings: split on the page header instead
    pages = body.split(/(?=UOB CARD CENTRE)/i).map((p) => p.trim()).filter(Boolean);
  }
  return pages.map(normalise);
}

function parseStatementDate(text) {
  const m = text.match(new RegExp(String.raw`STATEMENT DATE${SEP}(?:TARIKH PENYATA${SEP})?(\d{1,2}) ?(${MON}) ?(\d{2,4})`));
  if (!m) return null;
  let y = +m[3];
  if (y < 100) y += 2000;
  return isoDate(y, MONTHS.indexOf(m[2]) + 1, +m[1]);
}

function parseSummary(text) {
  const idx = Math.max(text.lastIndexOf('BAKI PERLU DIBAYAR'), text.lastIndexOf('TOTAL BALANCE DUE'));
  if (idx < 0) return null;
  let rest = text.slice(idx);
  const stop = rest.search(/TRANSACTION DATE|TARIKH TRANSAKSI/);
  if (stop > 0) rest = rest.slice(0, stop);
  const nums = [...rest.matchAll(new RegExp(AMT + '(?:' + SEP + '(CR))?', 'g'))].slice(0, 6);
  if (nums.length < 6) return null;
  const v = nums.map((n) => (n[2] ? -1 : 1) * toAmount(n[1]));
  return { previous_balance: v[0], credits: v[1], debits_fees: v[2], retail: v[3], cash_advance: v[4], total_due: v[5] };
}

/** Text of a transaction page after its table header, with any footer after the last amount removed. */
function transactionBody(page) {
  const h = page.lastIndexOf('AMAUN TRANSAKSI');
  if (h < 0) return null;
  let body = page.slice(h + 'AMAUN TRANSAKSI'.length).replace(/^[ ¦]*\(RM\)/, '');
  const amounts = [...body.matchAll(new RegExp(AMT + `(?:${SEP}CR)?(?:${SEP}[A-Z]{3}${SEP}${AMT})?`, 'g'))];
  if (!amounts.length) return body;
  const last = amounts[amounts.length - 1];
  return body.slice(0, last.index + last[0].length);
}

function cardName(text, markerIdx, markerLen) {
  const around = text.slice(Math.max(0, markerIdx - 40), markerIdx + markerLen + 30);
  const tier = around.match(/\b(PREFERRED|WORLD|PLATINUM|SIGNATURE|INFINITE|GOLD|CLASSIC|ONE|PRVI MILES|YOLO|ZENITH|SOLITAIRE|EVOL|LADY'?S|VISA INFINITE)\b/);
  const network = around.match(/\b(MASTERCARD|VISA|AMEX|UNIONPAY)\b/);
  return [tier?.[1], network?.[1]].filter(Boolean).join(' ') || null;
}

/** Splits a description into merchant / location / country. */
export function splitDescription(desc) {
  const cells = desc.split('¦').map((c) => c.trim()).filter(Boolean);
  let merchant, location = null, country = null;
  if (cells.length >= 2) {
    if (/^[A-Z]{2}$/.test(cells[cells.length - 1])) country = cells.pop();
    if (cells.length >= 2) location = cells.pop();
    merchant = cells.join(' ');
  } else {
    let s = cells[0] || '';
    const c = s.match(/^(.{3,}) ([A-Z]{2})$/);
    if (c) { s = c[1]; country = c[2]; }
    const place = KNOWN_PLACES.find((p) => s.endsWith(' ' + p));
    if (place) { location = place; s = s.slice(0, -place.length - 1); }
    merchant = s;
  }
  return { merchant: merchant.trim(), location, country };
}

function classify(description, isCredit) {
  if (isCredit) return /PAYMENT|BAYARAN|PYMT/.test(description) ? 'payment' : 'refund';
  return /\b(FEE|FEES|CHARGE|CHARGES|INTEREST|FINANCE|CAJ|YURAN|SST|SERVICE TAX)\b/.test(description) ? 'fee' : 'purchase';
}

function lineYear(month, day, statementDate) {
  if (!statementDate) return null;
  const sy = +statementDate.slice(0, 4);
  let d = isoDate(sy, month, day);
  if (!d) return null;
  // A transaction more than 10 days after the statement date belongs to the previous year
  if (Date.parse(d) - Date.parse(statementDate) > 10 * 86400_000) d = isoDate(sy - 1, month, day);
  return d;
}

function parseLines(content, statementDate) {
  const lineRe = new RegExp(
    String.raw`(\d{2}) ?(${MON})${SEP}(.+?)${SEP}${AMT}(?:${SEP}(CR)\b)?(?:${SEP}([A-Z]{3})${SEP}${AMT})?` +
    String.raw`(?=${SEP}(?:\d{2} ?(?:${MON})|${PAGE}|$))`,
    'g'
  );
  const lines = [];
  for (const m of content.matchAll(lineRe)) {
    let [, day, mon, desc, amount, cr, fxCur, fxAmt] = m;
    desc = desc.replace(new RegExp(PAGE, 'g'), ' ').replace(/ +/g, ' ').trim();
    // Foreign amount printed before the RM amount
    if (!fxCur) {
      const f = desc.match(new RegExp(String.raw`^(.*?)${SEP}\b([A-Z]{3})${SEP}${AMT}$`));
      if (f && !/^(CR)$/.test(f[2])) { desc = f[1].trim(); fxCur = f[2]; fxAmt = f[3]; }
    }
    const description = desc.replace(/ ?¦ ?/g, ' ').replace(/ +/g, ' ').trim();
    const isCredit = Boolean(cr);
    lines.push({
      txn_date: lineYear(MONTHS.indexOf(mon) + 1, +day, statementDate),
      description,
      ...splitDescription(desc),
      amount: toAmount(amount),
      is_credit: isCredit,
      kind: classify(description, isCredit),
      foreign_currency: fxCur || null,
      foreign_amount: fxAmt ? toAmount(fxAmt) : null,
    });
  }
  return lines;
}

/** Main entry. Returns { statement_date, summary, cards: [{ last4, name, previous_balance, subtotal, lines }], warnings }. */
export function parseUobStatement(markdown) {
  const warnings = [];
  const pages = splitPages(markdown || '');
  const all = pages.join(' ');

  const statement_date = parseStatementDate(all);
  if (!statement_date) warnings.push('Statement date not found');
  const summary = parseSummary(all);
  if (!summary) warnings.push('Statement summary totals not found');

  const txPages = pages.filter((p) => /TARIKH TRANSAKSI|TRANSACTION DESCRIPTION/.test(p));
  const bodies = txPages.map(transactionBody).filter(Boolean);
  const text = bodies.join(` ${PAGE} `);

  const markers = [...text.matchAll(/\*\*\s?(\d{4})/g)];
  if (!markers.length) warnings.push('No card sections found');

  const cards = markers.map((mk, i) => {
    const end = i + 1 < markers.length ? markers[i + 1].index : text.length;
    let section = text.slice(mk.index + mk[0].length, end);

    let subtotal = null;
    const st = section.match(new RegExp(String.raw`SUB-? ?TOTAL${SEP}${AMT}(?:${SEP}(CR)\b)?`));
    if (st) {
      subtotal = (st[2] ? -1 : 1) * toAmount(st[1]);
      section = section.slice(0, st.index);
    }
    let previous_balance = null;
    const pb = section.match(new RegExp(String.raw`PREVIOUS BAL(?:ANCE)?${SEP}${AMT}(?:${SEP}(CR)\b)?`));
    if (pb) {
      previous_balance = (pb[2] ? -1 : 1) * toAmount(pb[1]);
      section = section.slice(pb.index + pb[0].length);
    } else {
      section = section.replace(new RegExp(String.raw`CREDIT LIMIT${SEP}RM${SEP}${AMT}`), ' ');
    }
    // Trailing card-name text belonging to the next card (e.g. "MINIMUM PAYMENT DUE ... WORLD MASTERCARD")
    section = section.replace(new RegExp(String.raw`(MINIMUM PAYMENT DUE|BAYARAN MINIMUM)${SEP}${AMT}.*$`), '');

    const lines = parseLines(section, statement_date);
    if (!lines.length) warnings.push(`No transactions read for card **${mk[1]}`);
    return { last4: mk[1], name: cardName(text, mk.index, mk[0].length), previous_balance, subtotal, lines };
  });

  return { statement_date, summary, cards, warnings };
}

const round2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => Math.abs(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Compares parsed lines with the bank's own totals.
 * lines: [{ card, amount, is_credit }]; cards: [{ last4, previous_balance, subtotal }]
 */
export function computeChecks({ summary, cards, lines, rawText }) {
  const checks = [];
  const raw = (rawText || '').toUpperCase();

  const hint = (diff, pool) => {
    if (Math.abs(diff) < 0.005) return null;
    const amt = fmt(diff);
    if (diff > 0) {
      const inText = raw.split(amt).length - 1;
      const parsed = pool.filter((l) => fmt(l.amount) === amt).length;
      if (inText > parsed) return `RM ${amt} appears in the PDF text but not in the lines below: a line with this amount was probably missed.`;
      return `A line of about RM ${amt} seems to be missing, or an amount below is too low.`;
    }
    const same = pool.filter((l) => fmt(l.amount) === amt);
    if (same.length) return `A line of RM ${amt} may be duplicated or wrongly read (${same.length} line${same.length > 1 ? 's' : ''} below with that amount).`;
    return `The lines below add up to RM ${amt} more than the statement: an amount may be read too high.`;
  };

  for (const c of cards) {
    const cl = lines.filter((l) => l.card === c.last4);
    const debits = round2(cl.filter((l) => !l.is_credit).reduce((s, l) => s + l.amount, 0));
    const credits = round2(cl.filter((l) => l.is_credit).reduce((s, l) => s + l.amount, 0));
    if (c.subtotal == null || c.previous_balance == null) {
      checks.push({ scope: c.last4, label: `Card **${c.last4} sub-total`, ok: null, message: 'Sub-total or previous balance not found on the statement' });
      continue;
    }
    const computed = round2(c.previous_balance - credits + debits);
    const diff = round2(c.subtotal - computed);
    checks.push({
      scope: c.last4,
      label: `Card **${c.last4} sub-total`,
      expected: c.subtotal, actual: computed, diff,
      ok: Math.abs(diff) < 0.005,
      detail: `Previous ${fmt(c.previous_balance)} − credits ${fmt(credits)} + purchases ${fmt(debits)} = ${fmt(computed)}`,
      hint: hint(diff, cl),
    });
  }

  if (summary) {
    const debits = round2(lines.filter((l) => !l.is_credit).reduce((s, l) => s + l.amount, 0));
    const expected = round2(summary.retail + summary.debits_fees + summary.cash_advance);
    const diff = round2(expected - debits);
    checks.push({ scope: 'all', label: 'Total purchases and fees', expected, actual: debits, diff, ok: Math.abs(diff) < 0.005, hint: hint(diff, lines) });

    const credits = round2(lines.filter((l) => l.is_credit).reduce((s, l) => s + l.amount, 0));
    const cdiff = round2(summary.credits - credits);
    checks.push({ scope: 'all', label: 'Total payments and credits', expected: summary.credits, actual: credits, diff: cdiff, ok: Math.abs(cdiff) < 0.005 });
  } else {
    checks.push({ scope: 'all', label: 'Statement totals', ok: null, message: 'Summary totals not found on the statement' });
  }

  return { checks, ok: checks.every((c) => c.ok !== false) && checks.some((c) => c.ok === true) };
}
