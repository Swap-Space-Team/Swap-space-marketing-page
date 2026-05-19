// js/ui-header.js — header, user switcher, today callout, tab bar,
// saved-indicator, unread badge, completion %.

import { state } from './state.js';
import { getCurrentUser, setCurrentUser, USERS } from './current-user.js';
import { todayISO, formatDate, escapeHtml } from './util.js';

export const TABS = [
  { id: 'schedule', label: '📅 Schedule' },
  { id: 'subreddits', label: '🔗 Subreddits' },
  { id: 'backfill', label: '🔍 Backfill' },
  { id: 'activity', label: '📋 Activity Log' },
];

let savedTimer = null;
let savedWired = false;

function unreadCount() {
  return state.matches.filter((m) => m.status === 'unread').length;
}

// completion % = Done non-Browse / total non-Browse * 100
function completionPct() {
  const actionable = state.scheduleEntries.filter((e) => e.action !== 'Browse');
  if (!actionable.length) return 0;
  const done = actionable.filter((e) => e.status === 'Done').length;
  return Math.round((done / actionable.length) * 100);
}

function todayItems() {
  const t = todayISO();
  return state.scheduleEntries.filter((e) => e.date === t);
}

export function renderHeader(activeTab) {
  const el = document.getElementById('appHeader');
  const user = getCurrentUser() || '—';
  const unread = unreadCount();
  const pct = completionPct();
  const today = todayItems();

  const actionPill = (a) =>
    `<span class="pill pill-${a.toLowerCase()}">${escapeHtml(a)}</span>`;
  const whoClass = (w) => `who-${w.toLowerCase()}`;

  el.innerHTML = `
    <div class="hdr-row">
      <div>
        <div class="hdr-pretitle">SwapSpace</div>
        <h1 class="hdr-title">Reddit Engagement System</h1>
        <div class="hdr-sub">Ola + Ezekiel · 8-week rotating cycle</div>
      </div>
      <div class="hdr-right">
        <span id="savedIndicator" class="saved-indicator"></span>
        ${
          unread > 0
            ? `<button class="unread-badge" data-tab="backfill" title="Go to Backfill">🔔 ${unread} unread</button>`
            : ''
        }
        <div class="hdr-stat">
          <div class="num">${pct}%</div>
          <div class="lbl">Actions completed</div>
        </div>
        <div class="user-switch">
          <button class="user-switch-btn" id="userSwitchBtn">👤 ${escapeHtml(user)} ▼</button>
          <div class="user-menu hidden" id="userMenu">
            ${USERS.map(
              (u) =>
                `<button data-set-user="${u}" class="${u === user ? 'active' : ''}">👤 ${u}</button>`
            ).join('')}
          </div>
        </div>
      </div>
    </div>

    ${
      today.length
        ? `<div class="today-callout">
             <span class="tc-label">📌 Today</span>
             ${today
               .map(
                 (e) => `<span class="today-item">
                   ${actionPill(e.action)}
                   <span class="${whoClass(e.who)}">${escapeHtml(e.who)}</span>
                   ${e.subreddit ? `· ${escapeHtml(e.subreddit)}` : ''}
                 </span>`
               )
               .join('')}
           </div>`
        : ''
    }

    <nav class="tab-bar">
      ${TABS.map(
        (t) => `<button class="tab-btn ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}">
          ${t.label}
          ${
            t.id === 'backfill' && unread > 0
              ? `<span class="tab-count">${unread}</span>`
              : ''
          }
        </button>`
      ).join('')}
    </nav>
  `;

  wireUserSwitch(user);
  wireSavedIndicator();
}

function wireUserSwitch(currentUser) {
  const btn = document.getElementById('userSwitchBtn');
  const menu = document.getElementById('userMenu');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
  });
  menu.querySelectorAll('[data-set-user]').forEach((b) => {
    b.addEventListener('click', () => {
      setCurrentUser(b.dataset.setUser);
      menu.classList.add('hidden');
    });
  });
  document.addEventListener(
    'click',
    () => menu && menu.classList.add('hidden'),
    { once: true }
  );
}

// Saved indicator: listens to api.js window events. Wired once.
function wireSavedIndicator() {
  if (savedWired) return;
  savedWired = true;

  const flash = (cls, text, ms) => {
    const ind = document.getElementById('savedIndicator');
    if (!ind) return;
    clearTimeout(savedTimer);
    ind.className = `saved-indicator show ${cls}`;
    ind.textContent = text;
    savedTimer = setTimeout(() => {
      ind.className = 'saved-indicator';
    }, ms);
  };

  window.addEventListener('sb:saved', () => flash('ok', '✓ Saved', 2200));
  window.addEventListener('sb:error', () =>
    flash('err', '✗ Save failed — retry', 4000)
  );
}
