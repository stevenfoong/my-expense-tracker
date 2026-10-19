// Single place that decides a receipt's status from its fields.
//   ok       - everything needed is present
//   pending  - only the RM amount is missing, and a foreign amount is recorded
//   review   - something else needs fixing
export function evaluate(r) {
  const problems = [];
  if (!r.merchant) problems.push('merchant missing');
  if (!r.txn_date) problems.push('date missing');
  if (!r.category) problems.push('category not set');

  const hasRm = r.total !== null && r.total !== undefined;
  const hasForeign = r.foreign_amount !== null && r.foreign_amount !== undefined && r.foreign_currency;
  if (!hasRm && !hasForeign) problems.push('total missing');

  if (problems.length) {
    if (!hasRm && hasForeign) problems.push('RM amount pending');
    return { status: 'review', error: problems.join(', ') };
  }
  if (!hasRm) return { status: 'pending', error: 'RM amount pending' };
  return { status: 'ok', error: null };
}
