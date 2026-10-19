import { normaliseDate, toNumber } from './util.js';

/** Validates user input for a statement line. Returns { values } or { error }. */
export function lineValues(body, current = {}) {
  const v = { txn_date: null, merchant: null, location: null, amount: null, is_credit: 0, foreign_currency: null, foreign_amount: null, ...current };
  if ('txn_date' in body) {
    v.txn_date = normaliseDate(body.txn_date);
    if (!v.txn_date) return { error: 'Invalid date' };
  }
  if ('merchant' in body) v.merchant = String(body.merchant || '').trim().toUpperCase() || null;
  if ('location' in body) v.location = String(body.location || '').trim().toUpperCase() || null;
  if ('amount' in body) {
    v.amount = toNumber(String(body.amount));
    if (v.amount === null || v.amount <= 0) return { error: 'Invalid amount' };
  }
  if ('is_credit' in body) v.is_credit = body.is_credit === true || body.is_credit === 'on' || body.is_credit === '1' ? 1 : 0;
  if ('foreign_currency' in body) v.foreign_currency = String(body.foreign_currency || '').trim().toUpperCase() || null;
  if ('foreign_amount' in body) v.foreign_amount = body.foreign_amount === '' || body.foreign_amount == null ? null : toNumber(String(body.foreign_amount));
  if (!v.foreign_currency) v.foreign_amount = null;
  if (!v.merchant) return { error: 'Description is required' };
  if (!v.txn_date) return { error: 'Date is required' };
  if (v.amount == null) return { error: 'Amount is required' };

  v.description = [v.merchant, v.location].filter(Boolean).join(' ');
  v.kind = v.is_credit
    ? (/PAYMENT|BAYARAN/.test(v.merchant) ? 'payment' : 'refund')
    : (/\b(FEE|FEES|CHARGE|CHARGES|INTEREST|FINANCE|CAJ|YURAN|SST|SERVICE TAX)\b/.test(v.merchant) ? 'fee' : 'purchase');
  return { values: v };
}
