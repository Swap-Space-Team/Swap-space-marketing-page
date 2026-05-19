# SwapSpace Reddit Engagement Dashboard

A no-build, plain HTML/CSS/ES-module dashboard for Ola + Ezekiel to run
SwapSpace's Reddit engagement: the 8-week rotating **Schedule**, **Backfill**
review of imported CSV matches, a **Subreddits** reference list, and an
**Activity Log**. It talks directly to Supabase.

It is the dashboard half of a two-part deliverable; the Node backfill/monitor
scripts live in `../swapspace-reddit/` (separate repo — see its README).

## Setup

1. **Create the schema.** In the Supabase SQL editor, run
   [`supabase-setup.sql`](./supabase-setup.sql) once. It creates the 6 tables +
   indexes, enables RLS with anon-access policies (spec §4 Option A), adds the
   tables to the realtime publication, and seeds the reference data. (DDL can't
   run from the browser, so this step is manual.)
2. **Supabase config.** This bundle gets `{ url, anonKey }` at runtime from the
   site's existing `/api/config` endpoint (see "Deviations" below). Make sure
   `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set in the host's env (they
   already are for this project). No code change needed.
3. **Deploy.** It's already in place at `/admin/reddit/`, behind the parent
   app's `/admin` password gate. Static files only — nothing to build.
4. **First visit.** A "Who are you?" picker stores Ola/Ezekiel in
   `localStorage`. The dashboard then idempotently seeds any missing data
   (subreddits, keywords, `app_state` defaults, and the 64 schedule rows) and
   loads.

### Running locally

`/api/config` only exists when the API layer is running, so use:

```bash
npm run dev:api      # serves static files + proxies /api/* (port 8080-ish)
```

then open `/admin/reddit/`. Pure static servers (`npm run dev`) won't have
`/api/config`; for that case paste the anon key into `FALLBACK.anonKey` in
`js/supabase-client.js` (the anon key is public under this security model).

## Security model & trade-off (spec §4, Option A)

The real access boundary is the **parent app's `/admin` password gate**. RLS is
enabled but the anon role is granted full access to these 6 tables, because the
browser only ever has the anon key and the URL is already gated.

**Trade-off:** anyone who has both the Supabase project URL **and** the anon key
could read/write this data without passing the admin gate. For a two-person
internal tool this is accepted risk (the URL is semi-private, Supabase logs all
access). To harden, switch to Option B (proxy writes through a server using the
service-role key) — not needed unless the dashboard is exposed beyond `/admin`.
The service-role key is **never** in this bundle.

## Deviations & decisions (documented per the build instruction)

- **Anon key delivery.** Spec Option A says "hardcode the anon key in the
  bundle." This project already ships an `/api/config` endpoint (the existing
  `/admin` app uses it) that returns `{ url, anonKey }` from server env vars.
  `js/supabase-client.js` reuses it so no key is committed to git. The security
  model is unchanged (still Option A — the key is still effectively public,
  just fetched at runtime), with an inline `FALLBACK` for static hosting.
- **Idempotent data seeding in the browser.** Spec only requires the dashboard
  to auto-generate the 64 schedule rows. We also seed subreddits / keywords /
  `app_state` defaults if those tables are empty, so the app works on a
  fresh-but-empty schema even before the SQL seed runs. Harmless if the SQL
  seed already ran (it `on conflict do nothing`s; the app checks "empty?"
  first). Table/RLS DDL still requires running the SQL file.
- **Two helper modules not in the spec file list:** `js/util.js` (date/time
  formatting, HTML escaping, the 220-char keyword-highlight snippet) and
  `js/modal.js` (promise-based confirm dialog). Pure refactor to keep the UI
  modules clean.
- **Live monitoring writes to `backfill_matches`, not Slack.** Spec §1/§14
  had the Node monitor post matches to Slack. By project decision the monitor
  instead `upsert`s matches into `backfill_matches` with `source='live'`, so
  they appear in the Backfill triage queue via Realtime (no Slack, no Gist —
  dedupe is the table PK). The schema gained a `source` column
  (`'backfill'` | `'live'`, idempotent migration in `supabase-setup.sql`);
  CSV imports are tagged `'backfill'`; live cards show a **⚡ Live** badge.
  The CSV import/export format is unchanged (`source` is DB/dashboard-only),
  so re-importing an exported CSV will label rows `'backfill'` regardless of
  origin — an accepted minor edge for a backup/restore path.
- **Realtime + fallback.** Supabase Realtime is subscribed for all six tables;
  on any change the affected slice is refetched and the active tab + header
  re-render. If the channel errors/times out it falls back to 30s polling while
  the tab is visible (spec §12).
- **Comment type pill** uses indigo (`#4338ca`) per spec §10 ("post in blue /
  comment in indigo"); post pill uses the blue token.
- **Browse rows** seed with `status = '—'` (the schema allows it) and render
  Subreddit/URL/Status as disabled `—`, per spec §8.
- **CSV export ignores the active filters** and exports *all* matches, per the
  spec §10 toolbar note. Filename `swapspace-backfill-YYYY-MM-DD.csv`.
- **"Acting as"** in the engagement banner defaults to the current user and is
  not persisted across reloads (it's a per-session intent, not identity).
- **Schedule start date** is read from `app_state.schedule_start_date`
  (default `2026-05-18`); changing it is a manual `app_state` edit (spec §16).

## File map

```
index.html                 shell: header mount, tab panels, modals
styles.css                 design system (spec §6 tokens)
supabase-setup.sql         schema + RLS + realtime + seed (run once)
js/supabase-client.js      client init (via /api/config, fallback inline)
js/current-user.js         Ola/Ezekiel localStorage session selector
js/state.js                in-memory cache + tiny pub/sub
js/api.js                  every Supabase query, grouped by table
js/cycle.js                8-day cycle + 64-row schedule generation
js/csv.js                  CSV parse (import) + serialize (export)
js/util.js                 formatting / escaping / snippet helpers
js/modal.js                confirm dialog
js/ui-header.js            header, user switch, today callout, tabs, saved ✓
js/ui-schedule.js          Schedule tab (inline edits, debounced writes)
js/ui-subreddits.js        Subreddits tab (read-only + category filter)
js/ui-backfill.js          Backfill tab (mode toggle, sidebar, match feed)
js/ui-activity-log.js      Activity Log tab (form + table)
js/main.js                 bootstrap/seed, tab router, realtime
```
