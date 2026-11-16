/* Key metrics dashboard.
   Replaces the old Metabase dashboard. All numbers come from our own
   /api/admin?resource=metrics proxy, which holds the internal API key
   server-side and forwards to the SwapSpace backend. The backend works the
   numbers out in one go and caches them for 5 minutes.

   User-visible text on this page avoids em dashes (house style). */

'use strict';

const PROXY = '/api/admin?resource=metrics';

// ── Boot ────────────────────────────────────────────────────────────────────
(async function boot() {
  const session = await requireAuth();
  if (!session) return; // requireAuth redirects to /admin

  const emailEl = document.getElementById('userEmail');
  if (emailEl && session.user) emailEl.textContent = session.user.email || '';

  await load();
})();

async function load() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const res = await adminFetch(PROXY);
    if (!res) return; // redirected to login
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Server responded ${res.status}`);
    render(data);
  } catch (err) {
    console.error('Failed to load metrics:', err);
    content.innerHTML = `
      <div class="mx-error">
        <p>Couldn't load metrics: ${escapeHtml(err.message)}.</p>
        <button class="btn btn-secondary btn-sm" onclick="load()">Try again</button>
      </div>`;
  }
}

// ── Render ──────────────────────────────────────────────────────────────────
function render(m) {
  const updated = m.generatedAt ? new Date(m.generatedAt) : null;
  document.getElementById('updatedLabel').textContent = updated
    ? `Updated ${updated.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Refreshes every 5 minutes.`
    : '';

  document.getElementById('content').innerHTML = `
    ${section('Overview', '', renderCards(m))}
    ${section('Member funnel',
      'Each step counts members who also completed every step before it. The percentage under each bar is the share of the previous step.',
      renderFunnel(m.funnel || []))}
    ${section('Weekly growth', 'New sign-ups and listings started per week (Monday to Sunday), last 12 weeks.',
      renderWeekly(m.weekly || []))}
    ${section('Supply and demand by city',
      'Published homes compared with saved searches, top 10 cities. More searches than homes points to where more hosts are needed.',
      renderCities(m.cities || []))}
  `;
}

function section(title, intro, body) {
  return `
    <section class="mx-section">
      <h2>${title}</h2>
      ${intro ? `<p class="mx-section-intro">${intro}</p>` : ''}
      ${body}
    </section>`;
}

function renderCards(m) {
  const mem = m.members || {};
  const homes = m.homes || {};
  const swaps = m.swaps || {};
  const cards = [
    card('Members', mem.total, `+${fmt(mem.newLast30Days)} in the last 30 days`),
    card('Active members', mem.activeLast30Days, 'Logged in during the last 30 days'),
    card('Published homes', homes.published, `+${fmt(homes.newLast30Days)} in the last 30 days, ${fmt(homes.unpublished)} unpublished`),
    card('Members with a published home', mem.withPublishedHome, `${pct(mem.withPublishedHome, mem.total)} of members`),
    card('Swap requests', swaps.requests, `+${fmt(swaps.requestsLast30Days)} in the last 30 days`),
    card('Completed swaps', swaps.completed, `${pct(swaps.completed, swaps.requests)} of requests`),
    card('ID verified', mem.idVerified, `${pct(mem.idVerified, mem.total)} of members`),
    card('Home verified', mem.homeVerified, `${pct(mem.homeVerified, mem.total)} of members`),
  ];
  return `<div class="mx-cards">${cards.join('')}</div>`;
}

function card(label, value, sub) {
  return `
    <div class="mx-card">
      <div class="mx-card-label">${label}</div>
      <div class="mx-card-value">${fmt(value)}</div>
      <div class="mx-card-sub">${sub}</div>
    </div>`;
}

function renderFunnel(steps) {
  if (!steps.length) return empty();
  const top = steps[0].count || 0;
  const rows = steps.map((s, i) => {
    const width = top ? Math.max((s.count / top) * 100, s.count ? 1 : 0) : 0;
    const fromPrev = i === 0 ? '' : `${pct(s.count, steps[i - 1].count)} of previous step`;
    return `
      <div class="mx-funnel-row">
        <div class="mx-funnel-label">${escapeHtml(s.label)}</div>
        <div class="mx-funnel-track"><div class="mx-funnel-bar" style="width:${width}%"></div></div>
        <div class="mx-funnel-count">${fmt(s.count)}<span>${pct(s.count, top)}</span></div>
        <div class="mx-funnel-step">${fromPrev}</div>
      </div>`;
  });
  return `<div class="mx-panel mx-funnel">${rows.join('')}</div>`;
}

function renderWeekly(weeks) {
  if (!weeks.length) return empty();
  const max = Math.max(1, ...weeks.map(w => Math.max(w.signups, w.listingsStarted)));
  const cols = weeks.map(w => {
    const label = new Date(`${w.weekStart}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `
      <div class="mx-week" title="Week of ${label}: ${w.signups} sign-ups, ${w.listingsStarted} listings started">
        <div class="mx-week-bars">
          <div class="mx-bar mx-bar--signups" style="height:${(w.signups / max) * 100}%"><span>${w.signups || ''}</span></div>
          <div class="mx-bar mx-bar--listings" style="height:${(w.listingsStarted / max) * 100}%"><span>${w.listingsStarted || ''}</span></div>
        </div>
        <div class="mx-week-label">${label}</div>
      </div>`;
  });
  return `
    <div class="mx-panel">
      <div class="mx-legend">
        <span><i class="mx-swatch mx-bar--signups"></i>Sign-ups</span>
        <span><i class="mx-swatch mx-bar--listings"></i>Listings started</span>
      </div>
      <div class="mx-weekly">${cols.join('')}</div>
    </div>`;
}

function renderCities(cities) {
  if (!cities.length) return empty('No published homes or saved searches with a city yet.');
  const rows = cities.map(c => `
    <tr>
      <td>${escapeHtml(c.city)}</td>
      <td class="mx-num">${fmt(c.homes)}</td>
      <td class="mx-num">${fmt(c.savedSearches)}</td>
    </tr>`);
  return `
    <div class="table-container">
      <table>
        <thead><tr><th>City</th><th class="mx-num">Homes</th><th class="mx-num">Searches</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function empty(text = 'No data yet.') {
  return `<div class="mx-panel mx-empty">${text}</div>`;
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-GB');
}

function pct(part, whole) {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}
