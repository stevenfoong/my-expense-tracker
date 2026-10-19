// Shared helpers for all tabs.

export async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    ...options,
    headers: options.body && !(options.body instanceof FormData)
      ? { 'content-type': 'application/json', ...options.headers }
      : options.headers,
  });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    if (res.redirected || res.status === 401 || res.status === 403) throw new Error('Session expired. Reload the page to sign in again.');
    throw new Error(`Unexpected response (${res.status})`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function toast(message, kind = 'info') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3500);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function money(amount, currency) {
  if (amount === null || amount === undefined) return '—';
  return `${currency || ''} ${Number(amount).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

export function fmtDate(iso) {
  if (!iso) return 'No date';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

let settingsCache = null;
export async function getSettings(force = false) {
  if (!settingsCache || force) settingsCache = await api('/settings');
  return settingsCache;
}
export function setSettingsCache(s) { settingsCache = s; }

/** Resize a photo on the device before upload (long edge 1600px, JPEG). PDFs pass through. */
export async function compressImage(file, maxEdge = 1600, quality = 0.85) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file; // e.g. HEIC on browsers that can't decode it: upload as-is
  }
}
