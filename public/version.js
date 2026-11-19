// App version. Bump VERSION and add a line to CHANGES with every change that is pushed.
// The page compares this (as loaded) with the copy on the server to tell when a newer version is online.
export const VERSION = '1.1.0';
export const RELEASED = '2026-11-19';

export const CHANGES = [
  ['1.1.0', '2026-11-19', 'Version shown in Settings, with a check for newer versions. Retry no longer creates duplicate receipts; possible duplicates are flagged.'],
  ['1.0.0', '2026-11-10', 'Receipts, manual entries, foreign currency, Spending search, Trends, statement reconciliation, storage download and cleanup.'],
];

/** Reads the version currently online (bypassing the cache). Returns null if it can't be checked. */
export async function onlineVersion() {
  try {
    const res = await fetch('/version.js?check=' + Date.now(), { cache: 'no-store' });
    const m = (await res.text()).match(/VERSION = '([^']+)'/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
