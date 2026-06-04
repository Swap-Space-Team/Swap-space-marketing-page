/* Email Snippet Generator
   Pulls the public SwapSpace property catalogue, lets an admin pick one,
   and builds a copy-paste-ready, email-client-safe HTML card for Resend.

   Auth + supabase helpers (requireAuth, getSession, signOut, toggleProfileMenu)
   come from /admin/admin.js. supabase-js UMD is loaded in index.html. */

'use strict';

// Same catalogue the marketing homepage uses, but proxied through our own API
// (/api/properties) so the browser fetches it same-origin. The upstream backend
// 403s cross-origin browser requests; the proxy fetches it server-side instead.
const LIST_ENDPOINT = '/api/properties';

// Where the email "View listing" button sends recipients.
const EMAIL_CTA_URL = 'https://app.swap-space.com/login';

// Public listing page (used only by the admin-facing "View listing page" link).
const LISTING_PAGE_BASE = 'https://www.swap-space.com/Propertydetails?id=';

// Brand
const BRAND_GREEN = '#079455';

let allProperties = [];   // transformed list
let selectedId = null;
let currentHtml = '';

// ── Boot ────────────────────────────────────────────────────────────────────
(async function boot() {
  const session = await requireAuth();
  if (!session) return; // requireAuth redirects to /admin

  const emailEl = document.getElementById('userEmail');
  if (emailEl && session.user) emailEl.textContent = session.user.email || '';

  document.getElementById('searchInput')
    .addEventListener('input', renderGrid);

  await loadProperties();
})();

// ── Data ──────────────────────────────────────────────────────────────────--
async function loadProperties() {
  const stateEl = document.getElementById('state');
  try {
    const res = await fetch(LIST_ENDPOINT);
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const data = await res.json();
    const arr = Array.isArray(data) ? data : (data.properties || data.data || []);

    allProperties = arr
      .map(transformProperty)
      .filter(p => p.id); // must have an id to be usable

    if (allProperties.length === 0) {
      stateEl.className = 'es-state';
      stateEl.textContent = 'No published properties were returned by the catalogue.';
      return;
    }

    stateEl.style.display = 'none';
    document.getElementById('searchInput').disabled = false;
    renderGrid();
  } catch (err) {
    console.error('Failed to load properties:', err);
    stateEl.className = 'es-state es-state--error';
    stateEl.textContent =
      `Couldn't load properties: ${err.message}. Check your connection and try refreshing.`;
    document.getElementById('countLabel').textContent = '';
  }
}

function transformProperty(p) {
  const city = p.address && p.address.city ? p.address.city : '';
  const country = p.address && p.address.country ? p.address.country : '';
  const locationParts = [city, country].filter(Boolean);
  const images = Array.isArray(p.images)
    ? p.images.map(img => normalizeImageUrl(typeof img === 'string' ? img : img && img.imageUrl)).filter(Boolean)
    : [];

  return {
    id: p.propertyId != null ? String(p.propertyId) : '',
    title: (p.propertyTitle || '').trim() || 'Untitled property',
    city,
    country,
    location: locationParts.join(', ') || 'Location not specified',
    description: (p.propertyDescription || '').trim(),
    bedrooms: numOr(p.bedroomNumber, 0),
    bathrooms: numOr(p.bathroomNumber, 0),
    livingRooms: numOr(p.livingRoomNumber, 0),
    months: Array.isArray(p.publicAvailableMonths) ? p.publicAvailableMonths : [],
    images,
  };
}

function numOr(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

// API returns bare hostnames like "d3vretalihqpwb.cloudfront.net/img.jpg" — make them absolute https.
function normalizeImageUrl(url) {
  if (!url) return '';
  if (/^(https?:\/\/|data:)/.test(url)) return url;
  if (/^\/\//.test(url)) return 'https:' + url;
  if (/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\//.test(url)) return 'https://' + url;
  return url;
}

// ── Picker grid ───────────────────────────────────────────────────────────--
function renderGrid() {
  const grid = document.getElementById('grid');
  const q = document.getElementById('searchInput').value.trim().toLowerCase();

  const filtered = q
    ? allProperties.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        p.country.toLowerCase().includes(q))
    : allProperties;

  document.getElementById('countLabel').textContent =
    `${filtered.length} of ${allProperties.length} ${allProperties.length === 1 ? 'property' : 'properties'}`;

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="es-state" style="grid-column:1/-1;">No properties match “${escapeHtml(q)}”.</div>`;
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const thumb = p.images[0]
      ? `<img class="es-card-thumb" src="${escapeAttr(p.images[0])}" alt="" loading="lazy">`
      : `<div class="es-card-thumb es-card-thumb--empty">No image</div>`;
    return `
      <button type="button" class="es-card${p.id === selectedId ? ' is-selected' : ''}" data-id="${escapeAttr(p.id)}" onclick="selectProperty('${escapeAttr(p.id)}')">
        ${thumb}
        <div class="es-card-body">
          <div class="es-card-title">${escapeHtml(p.title)}</div>
          <div class="es-card-loc">${escapeHtml(p.location)}</div>
          <div class="es-card-id">ID ${escapeHtml(p.id)}</div>
        </div>
      </button>`;
  }).join('');
}

function selectProperty(id) {
  selectedId = id;
  const prop = allProperties.find(p => p.id === id);
  if (!prop) return;

  // refresh selected highlight
  document.querySelectorAll('.es-card').forEach(el => {
    el.classList.toggle('is-selected', el.dataset.id === id);
  });

  currentHtml = buildEmailHtml(prop);

  document.getElementById('outTitle').textContent = prop.title;
  document.getElementById('outMeta').textContent =
    `${prop.location} · ID ${prop.id}`;
  document.getElementById('htmlSource').value = currentHtml;
  document.getElementById('openLink').href = LISTING_PAGE_BASE + encodeURIComponent(prop.id);

  renderPreview(currentHtml);

  const output = document.getElementById('output');
  output.classList.add('is-visible');
  output.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // reset copy button label
  resetCopyBtn();
}

// ── Preview ─────────────────────────────────────────────────────────────────
// The email renders at its true 600px width, then we scale it down with a CSS
// transform to fit the preview column (or to 375px to simulate a phone). A
// wrapper "stage" is sized to the scaled dimensions so layout stays tight.
const EMAIL_WIDTH = 600;
const MOBILE_WIDTH = 375;
let previewMode = 'desktop';

function renderPreview(html) {
  const frame = document.getElementById('previewFrame');
  const doc = frame.contentDocument || frame.contentWindow.document;
  // Load the cropped hero from the current origin (localhost in dev, the prod
  // admin in prod) rather than the absolute prod URL baked into the snippet —
  // otherwise the preview image would 404 until this build is deployed.
  const previewHtml = html.split(PROD_ORIGIN + '/api/property-image').join('/api/property-image');
  doc.open();
  doc.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<style>html,body{margin:0;padding:0;}</style></head><body>${previewHtml}</body></html>`
  );
  doc.close();

  fitPreview();
  frame.onload = fitPreview;
  setTimeout(fitPreview, 250);
  setTimeout(fitPreview, 1200);
  // Re-fit as each image loads (hero height isn't known until then).
  doc.querySelectorAll('img').forEach(img => { img.onload = fitPreview; img.onerror = fitPreview; });
}

function fitPreview() {
  const frame = document.getElementById('previewFrame');
  const stage = document.getElementById('previewStage');
  if (!frame || !stage) return;
  const doc = frame.contentDocument || frame.contentWindow.document;
  if (!doc || !doc.body) return;

  // Natural (unscaled) content height at 600px width.
  frame.style.height = 'auto';
  const contentH = doc.body.scrollHeight || 0;
  frame.style.height = contentH + 'px';

  // Available width inside the framed area (minus its 16px padding each side).
  const wrap = stage.parentElement;
  const available = Math.max(0, wrap.clientWidth - 32);
  const targetW = previewMode === 'mobile'
    ? MOBILE_WIDTH
    : Math.min(available, EMAIL_WIDTH);

  const scale = Math.max(0.1, targetW / EMAIL_WIDTH);
  frame.style.transform = `scale(${scale})`;
  stage.style.width = (EMAIL_WIDTH * scale) + 'px';
  stage.style.height = (contentH * scale) + 'px';
}

function setPreviewWidth(mode) {
  previewMode = mode;
  document.getElementById('viewDesktop').classList.toggle('is-active', mode === 'desktop');
  document.getElementById('viewMobile').classList.toggle('is-active', mode === 'mobile');
  fitPreview();
}

// Keep the preview fitted when the window resizes.
window.addEventListener('resize', () => { if (currentHtml) fitPreview(); });

// ── Copy ─────────────────────────────────────────────────────────────────--
async function copyHtml() {
  const btn = document.getElementById('copyBtn');
  const label = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy HTML';
  try {
    await navigator.clipboard.writeText(currentHtml);
    btn.innerHTML = '✓ Copied!';
  } catch (_) {
    // Fallback for browsers/permissions that block the async clipboard API.
    const ta = document.getElementById('htmlSource');
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    btn.innerHTML = ok ? '✓ Copied!' : '⚠ Press ⌘/Ctrl+C';
  }
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.innerHTML = label; }, 2000);
}

function resetCopyBtn() {
  const btn = document.getElementById('copyBtn');
  clearTimeout(btn._t);
  btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy HTML';
}

// ── Email HTML builder ───────────────────────────────────────────────────────
// Strict email-client rules: table layout, inline CSS, absolute image URLs,
// width/height + bgcolor attributes, bulletproof button, no JS/forms/style blocks.
function buildEmailHtml(p) {
  const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
  const hero = emailHeroSrc(p.images[0] || '');
  const title = escapeHtml(p.title);
  const location = escapeHtml(p.location);
  const description = escapeHtml(truncate(p.description, 180));
  const altText = escapeAttr(`${p.title} — ${p.location}`);

  const details = [];
  if (p.bedrooms > 0)    details.push(`${p.bedrooms} bedroom${p.bedrooms > 1 ? 's' : ''}`);
  if (p.bathrooms > 0)   details.push(`${p.bathrooms} bathroom${p.bathrooms > 1 ? 's' : ''}`);
  if (p.livingRooms > 0) details.push(`${p.livingRooms} living room${p.livingRooms > 1 ? 's' : ''}`);
  const detailLine = details.join('  &bull;  ');

  const months = (p.months || []).slice(0, 6).join(', ');

  const heroBlock = hero
    ? `              <tr>
                <td style="padding:0; font-size:0; line-height:0;">
                  <img src="${escapeAttr(hero)}" alt="${altText}" width="${HERO_W}" height="${HERO_H}" style="display:block; width:100%; max-width:${HERO_W}px; height:auto; border:0; outline:none; text-decoration:none;" />
                </td>
              </tr>
`
    : '';

  const detailBlock = detailLine
    ? `                <tr>
                  <td style="padding:0 0 18px;">
                    <p style="margin:0; font-size:14px; line-height:1.5; color:#6B7280; font-family:${FONT};">${detailLine}</p>
                  </td>
                </tr>
`
    : '';

  const monthsBlock = months
    ? `                <tr>
                  <td style="padding:0 0 22px;">
                    <p style="margin:0; font-size:13px; line-height:1.5; color:#079455; font-weight:600; font-family:${FONT};">Swap available: ${escapeHtml(months)}</p>
                  </td>
                </tr>
`
    : '';

  const descBlock = description
    ? `                <tr>
                  <td style="padding:0 0 18px;">
                    <p style="margin:0; font-size:16px; line-height:1.6; color:#374151; font-family:${FONT};">${description}</p>
                  </td>
                </tr>
`
    : '';

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; background-color:#F9FAFB;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background-color:#ffffff; border:1px solid #E5E7EB; border-radius:12px; overflow:hidden;">
${heroBlock}        <tr>
          <td style="padding:28px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:0 0 6px;">
                  <h1 style="margin:0; font-size:22px; line-height:1.3; font-weight:700; color:#111827; font-family:${FONT};">${title}</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:0 0 16px;">
                  <p style="margin:0; font-size:15px; line-height:1.4; font-weight:600; color:#079455; font-family:${FONT};">${location}</p>
                </td>
              </tr>
${descBlock}${detailBlock}${monthsBlock}              <tr>
                <td style="padding:4px 0 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" bgcolor="${BRAND_GREEN}" style="background-color:${BRAND_GREEN}; border-radius:8px;">
                        <a href="${EMAIL_CTA_URL}" target="_blank" style="display:inline-block; padding:14px 30px; font-size:16px; font-weight:600; color:#ffffff; text-decoration:none; font-family:${FONT};">View listing &rarr;</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

// ── Helpers ──────────────────────────────────────────────────────────────--

// Email clients can't reliably crop images (Outlook ignores CSS object-fit and
// background-image cropping is unsupported), so we bake a fixed 600×320 landscape
// crop via our own /api/property-image endpoint (auto-orients EXIF, then cover-
// crops). This renders at a consistent height in every client and shrinks multi-MB
// photos to ~100KB for deliverability.
//
// The copied snippet uses an absolute production URL so it works wherever the
// email is opened. The preview rewrites it to the current origin (see
// PROD_ORIGIN handling in renderPreview) so it also loads during local dev.
const HERO_W = 600, HERO_H = 320;
const PROD_ORIGIN = 'https://www.swap-space.com';

function emailHeroSrc(rawUrl) {
  if (!rawUrl) return '';
  const clean = rawUrl.replace(/^https?:\/\//, '');
  // Request at 2× (1200×640) for retina; displayed at 600×320.
  return `${PROD_ORIGIN}/api/property-image?url=${encodeURIComponent(clean)}` +
         `&w=${HERO_W * 2}&h=${HERO_H * 2}`;
}

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
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
window.selectProperty = selectProperty;
window.copyHtml = copyHtml;
window.setPreviewWidth = setPreviewWidth;
