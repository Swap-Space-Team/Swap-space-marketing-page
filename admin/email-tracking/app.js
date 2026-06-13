/* Email Tracking dashboard.
   Lists transactional emails sent by the SwapSpace platform with their
   delivery/engagement status, and drills into a per-email event timeline.

   All data comes from our own /api/email-tracking proxy, which holds the
   internal API key server-side and forwards to the SwapSpace backend. The
   browser only ever talks to the proxy, authenticated with the admin's JWT
   via adminFetch() (from /admin/admin.js). supabase-js + auth/profile helpers
   are loaded by index.html / admin.js. */

'use strict';

const PROXY = '/api/email-tracking';
const PAGE_SIZE = 50; // mirrors the upstream default; used to detect "more pages"

let currentType = '';   // '' = all types
let currentPage = 0;
let rows = [];          // the rows currently shown
let hasMore = false;    // exactly PAGE_SIZE returned -> there may be another page

// ── Boot ────────────────────────────────────────────────────────────────────
(async function boot() {
  const session = await requireAuth();
  if (!session) return; // requireAuth redirects to /admin

  const emailEl = document.getElementById('userEmail');
  if (emailEl && session.user) emailEl.textContent = session.user.email || '';

  document.getElementById('typeFilter').addEventListener('change', onTypeChange);
  document.getElementById('caveatsToggle').addEventListener('click', toggleCaveats);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  await loadTypes();
  await loadRows();
})();

// ── Email type filter ─────────────────────────────────────────────────────────
async function loadTypes() {
  const select = document.getElementById('typeFilter');
  try {
    const res = await adminFetch(`${PROXY}?resource=types`);
    if (!res) return;                       // adminFetch redirected to login
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const types = await res.json();

    if (Array.isArray(types) && types.length) {
      types.sort((a, b) => a.localeCompare(b));
      select.insertAdjacentHTML('beforeend', types
        .map(t => `<option value="${escapeAttr(t)}">${escapeHtml(prettyType(t))}</option>`)
        .join(''));
    }
    select.disabled = false;
  } catch (err) {
    // A missing dropdown isn't fatal — the table can still load "all types".
    console.error('Failed to load email types:', err);
  }
}

function onTypeChange(e) {
  currentType = e.target.value;
  currentPage = 0;
  loadRows();
}

// ── Rows ────────────────────────────────────────────────────────────────────
async function loadRows() {
  const body = document.getElementById('rowsBody');
  body.innerHTML = `<tr><td colspan="5" class="loading">Loading…</td></tr>`;
  document.getElementById('pager').style.display = 'none';
  document.getElementById('countLabel').textContent = 'Loading…';

  const params = new URLSearchParams({ page: String(currentPage), size: String(PAGE_SIZE) });
  if (currentType) params.set('emailType', currentType);

  try {
    const res = await adminFetch(`${PROXY}?${params.toString()}`);
    if (!res) return;                       // redirected to login
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const data = await res.json();

    rows = Array.isArray(data) ? data : [];
    // No total count is returned: a full page means there may be another.
    hasMore = rows.length === PAGE_SIZE;
    renderRows();
    renderPager();
  } catch (err) {
    console.error('Failed to load email tracking rows:', err);
    body.innerHTML = `
      <tr><td colspan="5">
        <div class="et-error">
          <p>Couldn't load emails: ${escapeHtml(err.message)}.</p>
          <button class="btn btn-primary btn-sm" onclick="loadRows()">Retry</button>
        </div>
      </td></tr>`;
    document.getElementById('countLabel').textContent = '';
  }
}

function renderRows() {
  const body = document.getElementById('rowsBody');
  const label = document.getElementById('countLabel');

  if (rows.length === 0) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state">No emails found${currentType ? ` for “${escapeHtml(prettyType(currentType))}”` : ''}.</div></td></tr>`;
    label.textContent = '0 emails';
    return;
  }

  label.textContent = `${rows.length} email${rows.length === 1 ? '' : 's'} on this page`;

  body.innerHTML = rows.map((r, i) => {
    const name = r.recipientName ? escapeHtml(r.recipientName) : '';
    const email = escapeHtml(r.recipientEmail || '—');
    const recipient = name
      ? `<div class="et-recipient"><span class="et-recipient-name">${name}</span><span class="et-recipient-email">${email}</span></div>`
      : `<div class="et-recipient"><span class="et-recipient-email et-recipient-email--solo">${email}</span></div>`;

    return `
      <tr data-i="${i}" onclick="openTimeline(${i})">
        <td>${recipient}</td>
        <td>${typeBadge(r.emailType)}</td>
        <td class="et-subject" title="${escapeAttr(r.subject || '')}">${escapeHtml(r.subject || '—')}</td>
        <td class="et-time">${formatDateTime(r.sentAt)}</td>
        <td>${statusCell(r)}</td>
      </tr>`;
  }).join('');
}

function renderPager() {
  const pager = document.getElementById('pager');
  // Hide the pager only when there's nothing beyond a single short first page.
  if (currentPage === 0 && !hasMore) { pager.style.display = 'none'; return; }
  pager.style.display = 'flex';
  document.getElementById('pageLabel').textContent = `Page ${currentPage + 1}`;
  document.getElementById('prevBtn').disabled = currentPage === 0;
  document.getElementById('nextBtn').disabled = !hasMore;
}

function changePage(delta) {
  const next = currentPage + delta;
  if (next < 0) return;
  if (delta > 0 && !hasMore) return;
  currentPage = next;
  loadRows();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Status rendering ──────────────────────────────────────────────────────────
// Single primary badge by priority, then small open/click counters alongside.
// Priority: Complained > Bounced > Clicked > Opened > Delivered > Sent/Pending.
function statusCell(r) {
  let badge;
  if (r.complained)     badge = chip('Complained', 'red');
  else if (r.bounced)   badge = chip('Bounced', 'red');
  else if (r.clicked)   badge = chip('Clicked', 'green');
  else if (r.opened)    badge = chip('Opened', 'blue');
  else if (r.delivered) badge = chip('Delivered', 'grey');
  else                  badge = chip(r.sentAt ? 'Sent' : 'Pending', 'faint');

  const counters = [];
  if (r.openCount > 0) {
    counters.push(`<span class="et-counter" title="Opens are estimates — clients pre-fetch the tracking pixel">👁 ${r.openCount}<span class="et-counter-est">est.</span></span>`);
  }
  if (r.clickCount > 0) {
    counters.push(`<span class="et-counter et-counter--click" title="Clicks are real human actions">🖱 ${r.clickCount}</span>`);
  }

  return `<div class="et-status">${badge}${counters.length ? `<span class="et-counters">${counters.join('')}</span>` : ''}</div>`;
}

function chip(label, tone) {
  return `<span class="et-chip et-chip--${tone}">${label}</span>`;
}

function typeBadge(type) {
  if (!type) return `<span class="et-type et-type--none">Uncategorized</span>`;
  return `<span class="et-type">${escapeHtml(prettyType(type))}</span>`;
}

// "swap-request-initiated" -> "Swap request initiated"
function prettyType(t) {
  const s = String(t || '').replace(/[-_]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : t;
}

// ── Timeline drawer ───────────────────────────────────────────────────────────
async function openTimeline(i) {
  const row = rows[i];
  if (!row) return;

  document.getElementById('drawerTitle').textContent = row.subject || '(no subject)';
  document.getElementById('drawerMeta').innerHTML =
    `${escapeHtml(row.recipientName ? `${row.recipientName} · ` : '')}${escapeHtml(row.recipientEmail || '')}` +
    `<span class="et-drawer-type">${escapeHtml(row.emailType ? prettyType(row.emailType) : 'Uncategorized')}</span>`;

  const body = document.getElementById('drawerBody');
  body.innerHTML = `<div class="loading">Loading timeline…</div>`;
  openDrawer();

  try {
    const res = await adminFetch(`${PROXY}?resource=timeline&messageId=${encodeURIComponent(row.messageId)}`);
    if (!res) return;
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const events = await res.json();
    renderTimeline(Array.isArray(events) ? events : [], row);
  } catch (err) {
    console.error('Failed to load timeline:', err);
    body.innerHTML = `
      <div class="et-error">
        <p>Couldn't load this email's timeline: ${escapeHtml(err.message)}.</p>
        <button class="btn btn-primary btn-sm" onclick="openTimeline(${i})">Retry</button>
      </div>`;
  }
}

function renderTimeline(events, row) {
  const body = document.getElementById('drawerBody');

  if (events.length === 0) {
    body.innerHTML = `<div class="empty-state">No events recorded yet for this email.</div>`;
    return;
  }

  const items = events.map(ev => {
    const tone = eventTone(ev.eventType);
    const when = formatDateTime(ev.eventTimestamp || ev.receivedAt);
    const recorded = ev.eventTimestamp && ev.receivedAt && ev.receivedAt !== ev.eventTimestamp
      ? `<div class="et-event-recorded">recorded ${escapeHtml(formatDateTime(ev.receivedAt))}</div>`
      : '';
    const detail = ev.detail
      ? `<div class="et-event-detail">${escapeHtml(ev.detail)}</div>`
      : '';
    const note = ev.eventType === 'Open'
      ? `<div class="et-event-note">Opens may be machine prefetches, not a person.</div>`
      : '';

    return `
      <li class="et-event">
        <span class="et-event-dot et-event-dot--${tone}"></span>
        <div class="et-event-content">
          <div class="et-event-top">
            <span class="et-event-type">${escapeHtml(ev.eventType || 'Event')}</span>
            <span class="et-event-time">${escapeHtml(when)}</span>
          </div>
          ${detail}
          ${note}
          ${recorded}
        </div>
      </li>`;
  }).join('');

  body.innerHTML = `<ol class="et-timeline">${items}</ol>`;
}

// Map upstream event types to a colour tone for the timeline dot.
function eventTone(type) {
  switch (type) {
    case 'Bounce':
    case 'Complaint':
    case 'Reject':        return 'red';
    case 'Click':         return 'green';
    case 'Open':          return 'blue';
    case 'Delivery':      return 'grey';
    case 'DeliveryDelay': return 'amber';
    default:              return 'faint'; // Send and anything new
  }
}

function openDrawer() {
  document.getElementById('drawerOverlay').classList.add('open');
  const drawer = document.getElementById('drawer');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  document.getElementById('drawerOverlay').classList.remove('open');
  const drawer = document.getElementById('drawer');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
}

// ── Caveats panel ─────────────────────────────────────────────────────────────
function toggleCaveats() {
  const btn = document.getElementById('caveatsToggle');
  const open = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!open));
  document.getElementById('caveats').classList.toggle('is-collapsed', open);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Render ISO-8601 UTC strings in the admin's local timezone. Null/empty -> em dash.
function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

// expose handlers used by inline onclick attributes
window.openTimeline = openTimeline;
window.closeDrawer = closeDrawer;
window.changePage = changePage;
window.loadRows = loadRows;
