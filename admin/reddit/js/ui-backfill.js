// js/ui-backfill.js — backfill matches feed, sidebar config, mode toggle.

import { state } from './state.js';
import {
  importMatches,
  clearMatches,
  updateMatch,
  addKeyword,
  removeKeyword,
  setSubredditWatched,
  addActivity,
  setAppState,
  getMatches,
} from './api.js';
import { getCurrentUser } from './current-user.js';
import { confirmDialog } from './modal.js';
import {
  parseBackfillCsv,
  matchesToCsv,
  downloadCsv,
} from './csv.js';
import { relTime, todayISO, escapeHtml, buildSnippet } from './util.js';

let statusFilter = 'unread';
let subFilter = 'all';
let kwFilter = 'all';
let sortOrder = 'newest';
let importMsg = null; // { ok:boolean, text:string }

function isEngagement() {
  return state.backfillMode === 'engagement';
}

function counts() {
  const c = { unread: 0, replied: 0, dismissed: 0 };
  for (const m of state.matches) c[m.status] = (c[m.status] || 0) + 1;
  c.all = state.matches.length;
  return c;
}

export function renderBackfill() {
  const root = document.getElementById('tab-backfill');
  root.innerHTML = `
    <div id="modeBanner"></div>
    <div class="backfill-grid">
      <div id="bfSidebar"></div>
      <div id="bfContent"></div>
    </div>
  `;
  renderBanner();
  renderSidebar();
  renderContent();
}

/* ── Mode banner ──────────────────────────────────────────────────────── */

function renderBanner() {
  const el = document.getElementById('modeBanner');
  const eng = isEngagement();
  if (!state.actingAs) state.actingAs = getCurrentUser();

  el.className = `mode-banner ${eng ? 'engagement' : 'tuning'}`;
  el.innerHTML = eng
    ? `<div>
         <div class="mb-label">✅ Engagement mode</div>
         <div class="mb-sub">Reply on Reddit and log replies. Use Mark replied to auto-create Activity Log entries.</div>
       </div>
       <div class="mb-right">
         <label style="color:inherit">Acting as:</label>
         <select id="actingAs">
           ${['Ola', 'Ezekiel']
             .map(
               (u) => `<option ${u === state.actingAs ? 'selected' : ''}>${u}</option>`
             )
             .join('')}
         </select>
         <button class="btn btn-accent" id="toTuning">← Switch to Tuning</button>
       </div>`
    : `<div>
         <div class="mb-label">🔧 Tuning mode</div>
         <div class="mb-sub">Refine keywords + clear & re-run. Reply actions are disabled.</div>
       </div>
       <div class="mb-right">
         <button class="btn btn-success" id="toEngagement">Switch to Engagement →</button>
       </div>`;

  const actingSel = document.getElementById('actingAs');
  if (actingSel)
    actingSel.addEventListener('change', () => {
      state.actingAs = actingSel.value;
    });

  document.getElementById('toEngagement')?.addEventListener('click', () =>
    switchMode('engagement')
  );
  document.getElementById('toTuning')?.addEventListener('click', () =>
    switchMode('tuning')
  );
}

async function switchMode(target) {
  if (target === 'tuning') {
    const repliedExist = state.matches.some(
      (m) => m.status === 'replied' || m.status === 'dismissed'
    );
    if (repliedExist) {
      const ok = await confirmDialog({
        title: 'Switch to Tuning mode?',
        message:
          'Switching to Tuning mode unlocks Clear & re-run. Your replied/dismissed status will be preserved unless you clear. Continue?',
        okLabel: 'Switch to Tuning',
        okClass: 'btn-accent',
      });
      if (!ok) return;
    }
  }
  state.backfillMode = target;
  try {
    await setAppState('backfill_mode', { mode: target });
  } catch {
    /* toast fired in api.js; keep optimistic UI */
  }
  renderBackfill();
  window.dispatchEvent(new CustomEvent('header:refresh'));
}

/* ── Sidebar ──────────────────────────────────────────────────────────── */

function renderSidebar() {
  const el = document.getElementById('bfSidebar');
  const eng = isEngagement();
  const c = counts();
  const total = c.all;

  el.innerHTML = `
    <div class="card">
      <h3>${total ? `${total} matches` : 'Import backfill'}</h3>
      ${
        total
          ? `<div class="muted" style="font-size:12px;margin-top:2px">
               ${c.unread} unread · ${c.replied} replied · ${c.dismissed} dismissed
             </div>`
          : ''
      }
      <div style="margin-top:12px">
        ${
          eng
            ? `<div class="locked-msg">Import is locked in Engagement mode. Switch to Tuning to import another CSV or clear.</div>`
            : `<input type="file" id="csvInput" accept=".csv,text/csv" hidden />
               <button class="btn btn-primary" id="importBtn" style="width:100%">
                 📥 ${total ? 'Import another CSV' : 'Import CSV'}
               </button>
               <div class="muted" style="font-size:11px;margin-top:6px">
                 Run <code>npm run backfill</code> locally to produce a CSV.
               </div>
               ${
                 total
                   ? `<button class="btn btn-danger-outline" id="clearBtn" style="width:100%;margin-top:8px">Clear all matches</button>`
                   : ''
               }
               ${
                 importMsg
                   ? `<div class="import-msg ${importMsg.ok ? 'ok' : 'err'}">${escapeHtml(
                       importMsg.text
                     )}</div>`
                   : ''
               }`
        }
      </div>
    </div>

    <div class="card">
      <h3>Keywords (${state.keywords.length}) ${eng ? '<span class="lock">🔒</span>' : ''}</h3>
      <div class="kw-chips">
        ${
          state.keywords.length
            ? state.keywords
                .map(
                  (k) =>
                    `<span class="chip">${escapeHtml(k.keyword)}${
                      eng
                        ? ''
                        : `<button data-rm-kw="${k.id}" title="Remove">×</button>`
                    }</span>`
                )
                .join('')
            : '<span class="muted" style="font-size:12px">No keywords yet.</span>'
        }
      </div>
      ${
        eng
          ? ''
          : `<div class="kw-add">
               <input type="text" id="kwInput" placeholder="Add keyword…" />
               <button class="btn btn-primary btn-sm" id="kwAdd">Add</button>
             </div>`
      }
    </div>

    <div class="card">
      <h3>Subs to backfill (${
        state.subreddits.filter((s) => s.platform === 'Reddit' && s.is_watched).length
      }) ${eng ? '<span class="lock">🔒</span>' : ''}</h3>
      <div class="sub-toggle-list" style="margin-top:8px">
        ${state.subreddits
          .filter((s) => s.platform === 'Reddit')
          .map(
            (s) => `<label class="sub-toggle">
              <input type="checkbox" data-watch="${s.id}" ${s.is_watched ? 'checked' : ''} ${
              eng ? 'disabled' : ''
            } />
              <span>${escapeHtml(s.name)}</span>
              <span class="cat">${escapeHtml(s.category)}</span>
            </label>`
          )
          .join('')}
      </div>
    </div>
  `;

  wireSidebar(el);
}

function wireSidebar(el) {
  const fileInput = el.querySelector('#csvInput');
  el.querySelector('#importBtn')?.addEventListener('click', () => fileInput.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const rows = parseBackfillCsv(text);
      const { inserted, skipped } = await importMatches(rows);
      importMsg = {
        ok: true,
        text: `✓ Imported ${inserted} matches. ${skipped} duplicates skipped.`,
      };
      state.matches = await getMatches();
    } catch (err) {
      importMsg = { ok: false, text: `✗ ${err.message || err}` };
    }
    fileInput.value = '';
    renderBackfill();
    window.dispatchEvent(new CustomEvent('header:refresh'));
  });

  el.querySelector('#clearBtn')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Clear all matches?',
      message: `Delete all ${state.matches.length} backfill matches? This cannot be undone.`,
      okLabel: 'Delete all',
    });
    if (!ok) return;
    try {
      await clearMatches();
      state.matches = [];
      importMsg = null;
      renderBackfill();
      window.dispatchEvent(new CustomEvent('header:refresh'));
    } catch {
      /* toast fired */
    }
  });

  const addKw = async () => {
    const inp = el.querySelector('#kwInput');
    const val = inp.value.trim();
    if (!val) return;
    try {
      const created = await addKeyword(val);
      if (created && created[0]) state.keywords.push(created[0]);
      renderSidebar();
    } catch (err) {
      // most likely a unique-violation; surface briefly
      inp.value = '';
      inp.placeholder = `"${val}" already exists?`;
    }
  };
  el.querySelector('#kwAdd')?.addEventListener('click', addKw);
  el.querySelector('#kwInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKw();
    }
  });

  el.querySelectorAll('[data-rm-kw]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = Number(b.dataset.rmKw);
      try {
        await removeKeyword(id);
        state.keywords = state.keywords.filter((k) => k.id !== id);
        renderSidebar();
      } catch {
        /* toast fired */
      }
    })
  );

  el.querySelectorAll('[data-watch]').forEach((cb) =>
    cb.addEventListener('change', async () => {
      const id = Number(cb.dataset.watch);
      const sub = state.subreddits.find((s) => s.id === id);
      try {
        await setSubredditWatched(id, cb.checked);
        if (sub) sub.is_watched = cb.checked;
        renderSidebar();
      } catch {
        cb.checked = !cb.checked;
      }
    })
  );
}

/* ── Matches feed ─────────────────────────────────────────────────────── */

function visibleMatches() {
  let list = [...state.matches];
  if (statusFilter !== 'all') list = list.filter((m) => m.status === statusFilter);
  if (subFilter !== 'all') list = list.filter((m) => m.subreddit === subFilter);
  if (kwFilter !== 'all') list = list.filter((m) => (m.hits || []).includes(kwFilter));
  list.sort((a, b) => {
    const da = new Date(a.created_utc).getTime();
    const db = new Date(b.created_utc).getTime();
    return sortOrder === 'newest' ? db - da : da - db;
  });
  return list;
}

function renderContent() {
  const el = document.getElementById('bfContent');
  const c = counts();
  const subsWithMatches = Array.from(new Set(state.matches.map((m) => m.subreddit))).sort();
  const kwsWithMatches = Array.from(
    new Set(state.matches.flatMap((m) => m.hits || []))
  ).sort();
  const list = visibleMatches();

  el.innerHTML = `
    <div class="matches-toolbar">
      <span class="tb-count">Matches (${list.length} visible)</span>
      <select id="fStatus">
        <option value="unread" ${statusFilter === 'unread' ? 'selected' : ''}>Unread (${c.unread})</option>
        <option value="replied" ${statusFilter === 'replied' ? 'selected' : ''}>Replied (${c.replied})</option>
        <option value="dismissed" ${statusFilter === 'dismissed' ? 'selected' : ''}>Dismissed (${c.dismissed})</option>
        <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All (${c.all})</option>
      </select>
      <select id="fSub">
        <option value="all" ${subFilter === 'all' ? 'selected' : ''}>All subs</option>
        ${subsWithMatches
          .map(
            (s) =>
              `<option value="${escapeHtml(s)}" ${s === subFilter ? 'selected' : ''}>${escapeHtml(
                s
              )}</option>`
          )
          .join('')}
      </select>
      <select id="fKw">
        <option value="all" ${kwFilter === 'all' ? 'selected' : ''}>All keywords</option>
        ${kwsWithMatches
          .map(
            (k) =>
              `<option value="${escapeHtml(k)}" ${k === kwFilter ? 'selected' : ''}>${escapeHtml(
                k
              )}</option>`
          )
          .join('')}
      </select>
      <select id="fSort">
        <option value="newest" ${sortOrder === 'newest' ? 'selected' : ''}>Newest first</option>
        <option value="oldest" ${sortOrder === 'oldest' ? 'selected' : ''}>Oldest first</option>
      </select>
      <span class="spacer"></span>
      <button class="btn btn-ghost btn-sm" id="exportBtn" title="Export all matches">📥 Export CSV</button>
    </div>
    <div class="match-list">
      ${
        state.matches.length === 0
          ? `<div class="empty-state">Configure keywords + subs on the left, then click Run backfill.<br/><span class="muted">(Run <code>npm run backfill</code> in the swapspace-reddit repo, then Import the CSV.)</span></div>`
          : list.length === 0
          ? `<div class="empty-state">No matches in this filter.</div>`
          : list.map(matchCard).join('')
      }
    </div>
  `;

  wireContent(el);
}

function matchCard(m) {
  const eng = isEngagement();
  const isPost = m.type === 'post';
  const statusBadge =
    m.status === 'replied'
      ? '<span class="mc-status-badge replied">✓ Replied</span>'
      : m.status === 'dismissed'
      ? '<span class="mc-status-badge dismissed">Dismissed</span>'
      : '';

  const liveBadge =
    m.source === 'live' ? '<span class="mc-live" title="Found by the live monitor">⚡ Live</span>' : '';

  const kwPills = (m.hits || [])
    .filter((h) => h && h !== '(unknown)')
    .map((h) => `<span class="mc-kw">${escapeHtml(h)}</span>`)
    .join(' ');

  const actions = [];
  if (eng) {
    actions.push(
      `<a class="btn btn-primary btn-sm" href="${escapeHtml(
        m.url
      )}" target="_blank" rel="noopener" data-open="${m.id}">Open + reply →</a>`
    );
    if (m.status !== 'replied')
      actions.push(`<button class="btn btn-success btn-sm" data-replied="${m.id}">✓ Mark replied</button>`);
    if (m.status !== 'dismissed')
      actions.push(`<button class="btn btn-ghost btn-sm" data-dismiss="${m.id}">Dismiss</button>`);
    if (m.status === 'replied' || m.status === 'dismissed')
      actions.push(`<button class="btn btn-ghost btn-sm" data-restore="${m.id}">↩ Restore to unread</button>`);
  } else {
    actions.push(
      `<a class="btn btn-primary btn-sm" href="${escapeHtml(
        m.url
      )}" target="_blank" rel="noopener">Open on Reddit →</a>`
    );
    if (m.status !== 'dismissed')
      actions.push(`<button class="btn btn-ghost btn-sm" data-dismiss="${m.id}">Dismiss</button>`);
    if (m.status === 'replied' || m.status === 'dismissed')
      actions.push(`<button class="btn btn-ghost btn-sm" data-restore="${m.id}">↩ Restore to unread</button>`);
  }

  return `<div class="match-card s-${m.status}">
    <div class="mc-top">
      <span class="mc-sub">${escapeHtml(m.subreddit)}</span> ${liveBadge} ·
      <span class="pill ${isPost ? 'pill-post' : 'pill-reply'}" style="${
    isPost ? '' : 'background:#e0e7ff;color:#4338ca'
  }">${m.type}</span> ·
      <span>u/${escapeHtml(m.author || 'unknown')}</span> ·
      <span>${relTime(m.created_utc)}</span>
      ${isPost ? `· <span>${m.num_comments ?? 0} comments · ↑${m.score ?? 0}</span>` : ''}
      ${statusBadge}
      <span style="flex-basis:100%;height:2px"></span>
      ${kwPills}
    </div>
    <a class="mc-title" href="${escapeHtml(m.url)}" target="_blank" rel="noopener">${escapeHtml(
    m.title || '(no title)'
  )}</a>
    <div class="mc-snippet">${buildSnippet(m)}</div>
    <div class="mc-actions">${actions.join('')}</div>
  </div>`;
}

function wireContent(el) {
  el.querySelector('#fStatus').addEventListener('change', (e) => {
    statusFilter = e.target.value;
    renderContent();
  });
  el.querySelector('#fSub').addEventListener('change', (e) => {
    subFilter = e.target.value;
    renderContent();
  });
  el.querySelector('#fKw').addEventListener('change', (e) => {
    kwFilter = e.target.value;
    renderContent();
  });
  el.querySelector('#fSort').addEventListener('change', (e) => {
    sortOrder = e.target.value;
    renderContent();
  });
  el.querySelector('#exportBtn').addEventListener('click', () => {
    // Export ALL matches regardless of filters (spec §10 toolbar).
    const csv = matchesToCsv(state.matches);
    downloadCsv(`swapspace-backfill-${todayISO()}.csv`, csv);
  });

  el.querySelectorAll('[data-dismiss]').forEach((b) =>
    b.addEventListener('click', () => setStatus(b.dataset.dismiss, 'dismissed'))
  );
  el.querySelectorAll('[data-restore]').forEach((b) =>
    b.addEventListener('click', () => setStatus(b.dataset.restore, 'unread'))
  );
  el.querySelectorAll('[data-replied]').forEach((b) =>
    b.addEventListener('click', () => markReplied(b.dataset.replied))
  );
}

function localPatchMatch(id, patch) {
  const m = state.matches.find((x) => x.id === id);
  if (m) Object.assign(m, patch);
  return m;
}

async function setStatus(id, status) {
  const me = getCurrentUser();
  const patch = { status };
  if (status === 'unread') {
    patch.reviewed_at = null;
    patch.reviewed_by = null;
  } else {
    patch.reviewed_at = new Date().toISOString();
    patch.reviewed_by = me;
  }
  localPatchMatch(id, patch);
  renderBackfill();
  window.dispatchEvent(new CustomEvent('header:refresh'));
  try {
    await updateMatch(id, patch);
  } catch {
    state.matches = await getMatches();
    renderBackfill();
  }
}

async function markReplied(id) {
  const m = state.matches.find((x) => x.id === id);
  if (!m) return;
  const me = getCurrentUser();
  const actingAs = state.actingAs || me;
  const title = m.title || '';
  const trimmed = title.slice(0, 80) + (title.length > 80 ? '…' : '');

  const patch = {
    status: 'replied',
    reviewed_at: new Date().toISOString(),
    reviewed_by: me,
  };
  localPatchMatch(id, patch);
  renderBackfill();
  window.dispatchEvent(new CustomEvent('header:refresh'));

  try {
    await updateMatch(id, patch);
    const inserted = await addActivity({
      date: todayISO(),
      who: actingAs,
      subreddit: m.subreddit,
      url: m.url,
      type: 'Reply',
      notes: `[Backfill] ${trimmed}`,
      source: 'backfill_auto',
      source_match_id: m.id,
      created_by: me,
    });
    if (inserted && inserted[0]) state.activity.unshift(inserted[0]);
  } catch {
    // Re-sync from server if either write failed.
    state.matches = await getMatches();
    renderBackfill();
  }
}
