# swapspace-reddit

Backfill + live-monitor scripts for SwapSpace's Reddit engagement.

These scripts and the **dashboard** (in the marketing site's
`/admin/reddit/`) share **one source of truth: the Supabase database**.
Keywords and which subreddits to watch are configured **in the dashboard UI**,
not in code. Each script reads that config from Supabase on every run, so
changing a keyword or toggling a sub's `is_watched` flag in the dashboard takes
effect on the **next run with no redeploy**.

## Two scripts

| Command | What it does |
|---|---|
| `npm run backfill` | One-shot. Pulls ~90 days of history from Arctic Shift for every watched sub, keeps keyword matches, writes `backfill-YYYY-MM-DD.csv`. You import that file via the dashboard. |
| `npm run monitor` | Continuous (cron / GitHub Actions, every 5 min). Polls each watched sub's `/new` via Reddit OAuth and writes brand-new keyword matches **directly into Supabase `backfill_matches`** with `source='live'`. They show up in the dashboard's Backfill tab automatically (Supabase Realtime, ~1s). **No Slack, no Gist.** |
| `npm run monitor -- --dry-run` | Fetch + match + print counts, write **nothing**. Use it to sanity-check keyword/sub config before a real run. (`--seed` is a back-compat alias.) |

### How live matches reach the dashboard

The monitor `upsert`s matches into `backfill_matches`. The row `id`
(`post_<redditid>`, same convention as `backfill.js`) is the primary key, so
the insert is `ON CONFLICT (id) DO NOTHING` — **the table itself is the dedupe
store**. A post you've already replied to or dismissed is never resurrected;
re-seeing it is simply skipped. Live rows are tagged `source='live'` and the
dashboard shows a **⚡ Live** badge so they're distinguishable from CSV imports
(`source='backfill'`).

> Note: if you use the dashboard's **Clear all matches**, posts still inside
> each sub's most-recent ~25 `/new` window can be re-inserted by the next
> monitor run (the DB no longer remembers them). This is expected — clearing
> means "start over", and the monitor repopulates the current window.

## Setup

1. **Install** (Node 18+):
   ```bash
   npm install
   ```
2. **Configure env**: copy `.env.example` → `.env` and fill it in.
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings →
     API. Use the **service role** key (not anon): the scripts are unattended
     and RLS would otherwise block them. **It is a secret — never commit it.**
   - `REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD` — create a **script** app at
     <https://www.reddit.com/prefs/apps>. Username/password are the bot
     account's Reddit login.

   That's the entire env. There is no Slack webhook and no Gist to configure —
   matches go to Supabase and dedupe is the table's primary key.
3. **Make sure the dashboard's Supabase schema exists** — run
   `admin/reddit/supabase-setup.sql` once (the dashboard repo has it). Add
   keywords and tick watched subs in the dashboard before the first backfill.

## The handoff to the dashboard

```
npm run backfill          # produces backfill-2026-05-18.csv
```
Then open the dashboard → **Backfill** tab → **Import CSV** and pick that file.
The CSV header is exactly what the dashboard parser expects:

```
id,type,subreddit,title,body,author,created_iso,url,score,num_comments,hits,status
```

Import dedupes by `id`, so re-importing or importing overlapping runs is safe.
The same `id` convention means a post seen by the **live monitor** and later by
a **backfill CSV** will not double up.

## Deploying the monitor (GitHub Actions)

`.github/workflows/monitor.yml` runs `npm run monitor` every 5 minutes.

1. Push this repo to GitHub.
2. Add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD` as **Repository Secrets**
   (Settings → Secrets and variables → Actions).
3. Optionally run `npm run monitor -- --dry-run` first to confirm config.
4. The schedule (`*/5 * * * *`) takes over automatically. `workflow_dispatch`
   lets you trigger a run by hand.

## Deviation from the original spec

Spec §1/§14 architected live monitoring as a separate project that **posts to
Slack**. By project decision this was changed: the monitor writes matches
**straight into `backfill_matches` (`source='live'`)** instead. They land in
the dashboard's existing triage queue (Realtime, ~1s) with the same Mark
replied / Dismiss / auto-activity-log actions as imported matches. Consequences
of the change, all intentional:

- **No Slack** — there is no push notification; matches accumulate in the
  Backfill tab's Unread filter and the header's 🔔 badge.
- **No Gist** — dedupe is the `backfill_matches` primary key.
- The schema gained a `source` column (`'backfill'` | `'live'`); run the
  updated `admin/reddit/supabase-setup.sql` (it has an idempotent migration —
  existing imported rows correctly become `'backfill'`).

## Files

```
backfill.js                 one-shot history → CSV
monitor.js                  cron: /new → Supabase backfill_matches (--dry-run)
lib/supabase.js             config readers + insertLiveMatches() (shared truth)
lib/match.js                case-insensitive keyword matcher
lib/arctic-shift.js         history fetch (posts + comments search, paginated)
lib/reddit.js               Reddit OAuth script-app flow + /new fetch
.github/workflows/monitor.yml   every-5-min monitor run
```
