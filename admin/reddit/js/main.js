// js/main.js — entry point: first-visit picker, data bootstrap/seeding,
// tab router, realtime subscriptions.

import { supabase } from './supabase-client.js';
import { state } from './state.js';
import { getCurrentUser, setCurrentUser, needsPicker } from './current-user.js';
import { renderHeader, TABS } from './ui-header.js';
import { renderSchedule } from './ui-schedule.js';
import { renderSubreddits } from './ui-subreddits.js';
import { renderBackfill } from './ui-backfill.js';
import { renderActivityLog } from './ui-activity-log.js';
import { generateScheduleEntries } from './cycle.js';
import {
  ensureAppStateDefaults,
  ensureSubredditsSeed,
  ensureKeywordsSeed,
  getScheduleEntries,
  seedScheduleEntries,
  getMatches,
  getActivityLog,
  getAppState,
  getKeywords,
  getSubreddits,
} from './api.js';

let activeTab = 'schedule';

const RENDERERS = {
  schedule: renderSchedule,
  subreddits: renderSubreddits,
  backfill: renderBackfill,
  activity: renderActivityLog,
};

function showTab(tab) {
  if (!RENDERERS[tab]) tab = 'schedule';
  activeTab = tab;
  TABS.forEach((t) => {
    document
      .getElementById(`tab-${t.id}`)
      .classList.toggle('hidden', t.id !== tab);
  });
  renderHeader(activeTab);
  RENDERERS[tab]();
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
}

// Delegated tab/badge clicks (header is re-rendered often, so delegate on body).
document.addEventListener('click', (e) => {
  const tabEl = e.target.closest('[data-tab]');
  if (tabEl) showTab(tabEl.dataset.tab);
});

// ui modules ask the header to recompute (% complete, unread badge).
window.addEventListener('header:refresh', () => renderHeader(activeTab));
window.addEventListener('user:changed', () => renderHeader(activeTab));

// ── First-visit user picker ─────────────────────────────────────────────

function promptUserIfNeeded() {
  return new Promise((resolve) => {
    if (!needsPicker()) return resolve();
    const overlay = document.getElementById('userPicker');
    overlay.classList.remove('hidden');
    overlay.querySelectorAll('[data-user]').forEach((b) =>
      b.addEventListener('click', () => {
        setCurrentUser(b.dataset.user);
        overlay.classList.add('hidden');
        resolve();
      })
    );
  });
}

// ── Bootstrap / idempotent seeding ──────────────────────────────────────
// Tables + RLS must already exist (run supabase-setup.sql once). Data rows
// are seeded here if absent so the app works on a fresh-but-empty schema.

async function bootstrap() {
  await ensureAppStateDefaults();

  const [subs, kws] = await Promise.all([
    ensureSubredditsSeed(),
    ensureKeywordsSeed(),
  ]);
  state.subreddits = subs;
  state.keywords = kws;

  const startState = await getAppState('schedule_start_date');
  state.scheduleStartDate = (startState && startState.date) || '2026-05-18';

  const modeState = await getAppState('backfill_mode');
  state.backfillMode = (modeState && modeState.mode) || 'tuning';

  let entries = await getScheduleEntries();
  if (entries.length === 0) {
    entries = await seedScheduleEntries(
      generateScheduleEntries(state.scheduleStartDate)
    );
  }
  state.scheduleEntries = entries;

  const [matches, activity] = await Promise.all([
    getMatches(),
    getActivityLog(),
  ]);
  state.matches = matches;
  state.activity = activity;
  state.actingAs = getCurrentUser();
}

// ── Realtime ────────────────────────────────────────────────────────────
// On any change to a core table, refetch that slice and re-render whatever's
// affected (header always; active tab if relevant). Refetch (not patch) keeps
// this simple and correct; volume is tiny for a 2-person tool.

function rerenderActive() {
  RENDERERS[activeTab]();
  renderHeader(activeTab);
}

function subscribeRealtime() {
  const refreshers = {
    schedule_entries: async () => {
      state.scheduleEntries = await getScheduleEntries();
    },
    backfill_matches: async () => {
      state.matches = await getMatches();
    },
    activity_log: async () => {
      state.activity = await getActivityLog();
    },
    keywords: async () => {
      state.keywords = await getKeywords();
    },
    subreddits: async () => {
      state.subreddits = await getSubreddits();
    },
    app_state: async () => {
      const m = await getAppState('backfill_mode');
      if (m && m.mode) state.backfillMode = m.mode;
    },
  };

  const channel = supabase.channel('swapspace_realtime');
  Object.keys(refreshers).forEach((table) => {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      async () => {
        try {
          await refreshers[table]();
          rerenderActive();
        } catch (e) {
          console.warn(`[realtime] refresh ${table} failed`, e);
        }
      }
    );
  });
  channel.subscribe((status) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn('[realtime] channel issue, falling back to 30s polling');
      startPolling();
    }
  });
}

let pollTimer = null;
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (document.hidden) return;
    try {
      const [se, m, a] = await Promise.all([
        getScheduleEntries(),
        getMatches(),
        getActivityLog(),
      ]);
      state.scheduleEntries = se;
      state.matches = m;
      state.activity = a;
      rerenderActive();
    } catch (e) {
      console.warn('[poll] failed', e);
    }
  }, 30000);
}

// ── Boot ────────────────────────────────────────────────────────────────

function fatal(err) {
  console.error(err);
  const box = document.getElementById('bootError');
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="be-card">
      <h2>Couldn't start the dashboard</h2>
      <p>The Supabase tables/policies may not be set up yet. Run
      <code>admin/reddit/supabase-setup.sql</code> in the Supabase SQL editor,
      then reload.</p>
      <pre>${String(err && err.message ? err.message : err)}</pre>
    </div>`;
}

(async function init() {
  try {
    await promptUserIfNeeded();
    renderHeader(activeTab); // paint shell early
    document.getElementById('tab-schedule').innerHTML =
      '<div class="loading-block"><div class="spinner"></div>Loading…</div>';
    await bootstrap();
    showTab((location.hash || '#schedule').slice(1));
    subscribeRealtime();
  } catch (err) {
    fatal(err);
  }
})();
