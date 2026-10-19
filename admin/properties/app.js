/* Property moderation.
   Lists every listing on the platform and lets an admin unpublish one or
   delete individual photos.

   All data comes from our own /api/admin-properties proxy, which holds the
   internal API key server-side and forwards to the SwapSpace backend along
   with the signed-in admin's email (the backend audits every action under
   it). The browser only talks to the proxy, via adminFetch() from
   /admin/admin.js. */

'use strict';

const PROXY = '/api/admin-properties';
const PAGE_SIZE = 25;

let currentSearch = '';
let currentStatus = '';   // '' | 'true' | 'false'
let currentPage = 0;
let rows = [];
let totalPages = 0;
let totalElements = 0;
let openProperty = null;  // AdminPropertyDetail currently in the drawer
let busy = false;         // an unpublish/delete is in flight

// ── Boot ────────────────────────────────────────────────────────────────────
(async function boot() {
  const session = await requireAuth();
  if (!session) return; // requireAuth redirects to /admin

  const emailEl = document.getElementById('userEmail');
  if (emailEl && session.user) emailEl.textContent = session.user.email || '';

  document.getElementById('searchForm').addEventListener('submit', onSearch);
  document.getElementById('searchInput').addEventListener('search', onSearch); // the ✕ clear button
  document.getElementById('statusFilter').addEventListener('change', onStatusChange);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  await loadRows();
})();

function onSearch(e) {
  e.preventDefault();
  currentSearch = document.getElementById('searchInput').value.trim();
  currentPage = 0;
  loadRows();
}

function onStatusChange(e) {
  currentStatus = e.target.value;
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
  if (currentSearch) params.set('search', currentSearch);
  if (currentStatus) params.set('published', currentStatus);

  try {
    const res = await adminFetch(`${PROXY}?${params.toString()}`);
    if (!res) return; // redirected to login
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Server responded ${res.status}`);

    rows = Array.isArray(data.content) ? data.content : [];
    totalPages = data.totalPages || 0;
    totalElements = data.totalElements || 0;
    renderRows();
    renderPager();
  } catch (err) {
    console.error('Failed to load properties:', err);
    body.innerHTML = `
      <tr><td colspan="5">
        <div class="pp-error">
          <p>Couldn't load properties: ${escapeHtml(err.message)}.</p>
          <button class="btn btn-primary btn-sm" onclick="loadRows()">Retry</button>
        </div>
      </td></tr>`;
    document.getElementById('countLabel').textContent = '';
  }
}

function renderRows() {
  const body = document.getElementById('rowsBody');
  const label = document.getElementById('countLabel');

  label.textContent = `${totalElements} propert${totalElements === 1 ? 'y' : 'ies'}`;
  if (rows.length === 0) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state">No properties found.</div></td></tr>`;
    return;
  }

  body.innerHTML = rows.map((p, i) => `
    <tr class="pp-row" tabindex="0" onclick="openRow(${i})" onkeydown="if(event.key==='Enter')openRow(${i})">
      <td>
        <div class="pp-title">${escapeHtml(p.title || 'Untitled listing')}</div>
        <div class="pp-sub">#${p.id}</div>
      </td>
      <td>
        <div>${escapeHtml(p.hostName || '—')}</div>
        <div class="pp-sub">${escapeHtml(p.hostEmail || '')}</div>
      </td>
      <td>${escapeHtml(placeText(p) || '—')}</td>
      <td>${statusChip(p)}</td>
      <td class="pp-time">${formatDate(p.updatedAt || p.createdAt)}</td>
    </tr>`).join('');
}

function renderPager() {
  if (totalPages <= 1) return;
  document.getElementById('pager').style.display = 'flex';
  document.getElementById('pageLabel').textContent = `Page ${currentPage + 1} of ${totalPages}`;
  document.getElementById('prevBtn').disabled = currentPage === 0;
  document.getElementById('nextBtn').disabled = currentPage >= totalPages - 1;
}

function changePage(delta) {
  const next = currentPage + delta;
  if (next < 0 || next >= totalPages) return;
  currentPage = next;
  loadRows();
}

// ── Drawer ──────────────────────────────────────────────────────────────────
async function openRow(i) {
  const row = rows[i];
  if (!row) return;
  openProperty = null;
  document.getElementById('drawerTitle').textContent = row.title || 'Untitled listing';
  document.getElementById('drawerMeta').innerHTML = '';
  document.getElementById('drawerBody').innerHTML = `<div class="loading">Loading…</div>`;
  openDrawer();

  try {
    const res = await adminFetch(`${PROXY}?id=${encodeURIComponent(row.id)}`);
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Server responded ${res.status}`);
    renderDrawer(data);
  } catch (err) {
    console.error('Failed to load property:', err);
    document.getElementById('drawerBody').innerHTML = `
      <div class="pp-error">
        <p>Couldn't load this property: ${escapeHtml(err.message)}.</p>
        <button class="btn btn-primary btn-sm" onclick="openRow(${i})">Retry</button>
      </div>`;
  }
}

function renderDrawer(detail) {
  openProperty = detail;
  const s = detail.summary;

  document.getElementById('drawerTitle').textContent = s.title || 'Untitled listing';
  document.getElementById('drawerMeta').innerHTML = `
    <span>${statusChip(s)} <span class="pp-sub">#${s.id}</span></span>
    <span>${escapeHtml(s.hostName || '—')} · ${escapeHtml(s.hostEmail || '')}</span>
    ${placeText(s) ? `<span>${escapeHtml(placeText(s))}</span>` : ''}`;

  const missing = detail.missingForPublish || [];
  const missingNote = missing.length && s.published
    ? `<div class="pp-note pp-note--warn">This listing is live but no longer meets the publish bar. Still needed: ${escapeHtml(missing.join(', '))}.</div>`
    : '';

  const unpublishSection = s.published ? `
    <section class="pp-section">
      <h3>Unpublish</h3>
      <p class="pp-help">Removes the listing from search and browse. The host can see it in their account and edit it.</p>
      <label class="pp-label" for="reasonInput">Reason (kept in the audit log)</label>
      <textarea id="reasonInput" class="pp-textarea" rows="3" maxlength="1000" placeholder="e.g. Photos don't match the address"></textarea>
      <p class="pp-field-error" id="reasonError"></p>
      <button class="btn btn-danger-solid btn-sm" id="unpublishBtn" onclick="unpublish()">Unpublish listing</button>
    </section>` : `
    <section class="pp-section">
      <div class="pp-note">This listing is not published.</div>
    </section>`;

  const images = detail.images || [];
  const photos = images.length ? `
    <div class="pp-photos">
      ${images.map(img => `
        <div class="photo-item pp-photo">
          <img src="${escapeAttr(img.imageUrl || '')}" alt="" loading="lazy">
          <button class="photo-delete-btn" onclick="deleteImage(${Number(img.id)})" title="Delete photo" aria-label="Delete photo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>`).join('')}
    </div>` : `<div class="empty-state">No photos.</div>`;

  document.getElementById('drawerBody').innerHTML = `
    ${missingNote}
    ${unpublishSection}
    <section class="pp-section">
      <h3>Photos <span class="pp-sub">(${images.length})</span></h3>
      ${photos}
    </section>
    ${detail.description ? `<section class="pp-section"><h3>Description</h3><p class="pp-description">${escapeHtml(detail.description)}</p></section>` : ''}`;
}

// Replace the row in the table with the fresh summary, so the list matches the drawer.
function syncRow(summary) {
  const i = rows.findIndex(r => r.id === summary.id);
  if (i === -1) return;
  rows[i] = summary;
  renderRows();
}

// ── Actions ─────────────────────────────────────────────────────────────────
async function unpublish() {
  if (busy || !openProperty) return;
  const reason = document.getElementById('reasonInput').value.trim();
  const errorEl = document.getElementById('reasonError');
  errorEl.textContent = '';
  if (!reason) {
    errorEl.textContent = 'Add a reason before unpublishing.';
    document.getElementById('reasonInput').focus();
    return;
  }

  const ok = await showConfirm({
    title: 'Unpublish this listing?',
    message: 'It will disappear from search and browse straight away.',
    confirmText: 'Unpublish',
  });
  if (!ok) return;

  const btn = document.getElementById('unpublishBtn');
  await runAction(btn, 'Unpublishing…',
    `${PROXY}?id=${openProperty.summary.id}&action=unpublish`,
    { method: 'POST', body: JSON.stringify({ reason }) },
    'Listing unpublished');
}

async function deleteImage(imageId) {
  if (busy || !openProperty) return;
  const ok = await showConfirm({
    title: 'Delete this photo?',
    message: 'The photo is removed from the listing and deleted from storage. This can\'t be undone.',
    confirmText: 'Delete photo',
  });
  if (!ok) return;

  await runAction(null, null,
    `${PROXY}?id=${openProperty.summary.id}&imageId=${imageId}`,
    { method: 'DELETE' },
    'Photo deleted');
}

async function runAction(btn, busyLabel, url, options, successTitle) {
  busy = true;
  const original = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = busyLabel; }

  try {
    const res = await adminFetch(url, options);
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Server responded ${res.status}`);

    renderDrawer(data);
    syncRow(data.summary);
    showToast({ title: successTitle, variant: 'info', duration: 4000 });
  } catch (err) {
    console.error(`${successTitle} failed:`, err);
    showToast({ title: 'That didn\'t work', lines: [escapeHtml(err.message)], variant: 'danger' });
    if (btn) { btn.disabled = false; btn.textContent = original; }
  } finally {
    busy = false;
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
  openProperty = null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function placeText(p) {
  return [p.city, p.country].filter(Boolean).join(', ');
}

function statusChip(p) {
  if (p.published && p.available) return `<span class="pp-chip pp-chip--green">Live</span>`;
  if (p.published) return `<span class="pp-chip pp-chip--blue">Published · paused</span>`;
  return `<span class="pp-chip pp-chip--grey">Not published</span>`;
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
window.openRow = openRow;
window.closeDrawer = closeDrawer;
window.changePage = changePage;
window.loadRows = loadRows;
window.unpublish = unpublish;
window.deleteImage = deleteImage;
