// js/util.js — shared formatting/escaping helpers.
// (Not in the spec's file list, but keeps the UI modules free of duplicated
//  string-munging. Documented as an additive helper in the README.)

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Today's date as yyyy-mm-dd in the browser's local timezone.
export function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

// "2026-05-18" -> "18 May 2026"
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${d} ${months[m - 1]} ${y}`;
}

// Relative time like "3d ago", "5h ago", "just now".
export function relTime(input) {
  const t = new Date(input).getTime();
  if (isNaN(t)) return '';
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

// Build a ~220-char snippet centred on the first keyword hit, with every hit
// wrapped in <mark class="hl">. Returns HTML-safe markup.
export function buildSnippet(match, windowSize = 220) {
  const text = `${match.title ? match.title + ' — ' : ''}${match.body || ''}`.trim();
  const hits = (match.hits || []).filter((h) => h && h !== '(unknown)');

  let start = 0;
  if (hits.length) {
    const lower = text.toLowerCase();
    let first = -1;
    for (const h of hits) {
      const i = lower.indexOf(h.toLowerCase());
      if (i !== -1 && (first === -1 || i < first)) first = i;
    }
    if (first > -1) start = Math.max(0, first - Math.floor(windowSize / 3));
  }

  let slice = text.slice(start, start + windowSize);
  const prefix = start > 0 ? '… ' : '';
  const suffix = start + windowSize < text.length ? ' …' : '';

  let html = escapeHtml(slice);
  for (const h of hits) {
    const re = new RegExp(`(${escapeRegExp(escapeHtml(h))})`, 'gi');
    html = html.replace(re, '<mark class="hl">$1</mark>');
  }
  return prefix + html + suffix;
}
