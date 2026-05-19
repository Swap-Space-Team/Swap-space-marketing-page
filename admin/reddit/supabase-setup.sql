-- ============================================================================
-- SwapSpace Reddit Engagement Dashboard — Supabase setup
-- Run this ONCE in the Supabase SQL editor for the project.
--
-- It is idempotent-ish: tables use `create table if not exists`, the seed
-- inserts use `on conflict do nothing`, so re-running is safe.
--
-- DDL (create table / policies) cannot run from the browser with the anon
-- key, so this file must be applied manually. The dashboard itself will
-- idempotently seed data rows (subreddits / keywords / app_state / the 64
-- schedule entries) on first load, but the tables + RLS policies below must
-- exist first.
-- ============================================================================

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists subreddits (
  id serial primary key,
  name text unique not null,        -- "r/travel" or facebook group name
  url text not null,
  platform text not null check (platform in ('Reddit', 'Facebook')),
  category text not null,
  is_watched boolean default false, -- include in backfill/monitor
  created_at timestamptz default now()
);

create table if not exists keywords (
  id serial primary key,
  keyword text unique not null,
  created_at timestamptz default now()
);

create table if not exists schedule_entries (
  id text primary key,              -- format "weekN-dayM" e.g. "1-0", "2-3"
  week int not null,
  day_offset int not null,          -- 0..7 within the cycle
  date date not null,
  action text not null check (action in ('Post', 'Reply', 'Browse')),
  who text not null check (who in ('Ola', 'Ezekiel', 'Both')),
  notes text,
  subreddit text default '',
  url text default '',
  status text not null default 'Pending' check (status in ('Pending', 'Done', 'Skipped', '—')),
  updated_at timestamptz default now(),
  updated_by text check (updated_by in ('Ola', 'Ezekiel'))
);

create table if not exists backfill_matches (
  id text primary key,              -- "post_abc123" or "comment_xyz"
  type text not null check (type in ('post', 'comment')),
  subreddit text not null,
  title text,
  body text,
  author text,
  created_utc timestamptz not null,
  url text not null,
  score int default 0,
  num_comments int default 0,
  hits text[] not null,
  status text not null default 'unread' check (status in ('unread', 'replied', 'dismissed')),
  reviewed_at timestamptz,
  reviewed_by text check (reviewed_by in ('Ola', 'Ezekiel')),
  reply_notes text,
  -- 'backfill' = imported from a CSV; 'live' = inserted by the Node monitor.
  source text not null default 'backfill' check (source in ('backfill', 'live')),
  imported_at timestamptz default now()
);
-- Idempotent migration for tables created before `source` existed. Existing
-- rows (all CSV imports) correctly take the 'backfill' default.
alter table backfill_matches
  add column if not exists source text not null default 'backfill';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'backfill_matches_source_check'
  ) then
    alter table backfill_matches
      add constraint backfill_matches_source_check
      check (source in ('backfill', 'live'));
  end if;
end $$;
create index if not exists backfill_matches_status_idx on backfill_matches(status);
create index if not exists backfill_matches_subreddit_idx on backfill_matches(subreddit);
create index if not exists backfill_matches_created_utc_idx on backfill_matches(created_utc desc);

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  who text not null check (who in ('Ola', 'Ezekiel')),
  subreddit text not null,
  url text,
  type text not null check (type in ('Post', 'Reply', 'Browse find')),
  upvotes int,
  notes text,
  schedule_day int,
  source text default 'manual' check (source in ('manual', 'backfill_auto', 'live_alert')),
  source_match_id text,             -- references backfill_matches.id if source='backfill_auto'
  created_at timestamptz default now(),
  created_by text check (created_by in ('Ola', 'Ezekiel'))
);
create index if not exists activity_log_date_idx on activity_log(date desc);

create table if not exists app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);
-- Expected keys:
--   'backfill_mode': { "mode": "tuning" | "engagement" }
--   'schedule_start_date': { "date": "2026-05-18" }

-- ── Row-Level Security: Option A (open RLS, rely on parent /admin gate) ──────
-- The dashboard sits behind the parent app's password-protected /admin area.
-- The anon key is the only credential the browser has; we let the anon role do
-- everything on these tables. See README "Security model & trade-offs".

alter table subreddits        enable row level security;
alter table keywords          enable row level security;
alter table schedule_entries  enable row level security;
alter table backfill_matches  enable row level security;
alter table activity_log      enable row level security;
alter table app_state         enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array[
      'subreddits','keywords','schedule_entries',
      'backfill_matches','activity_log','app_state']) loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = 'anon_full_access'
    ) then
      execute format($p$
        create policy "anon_full_access" on %I
        for all to anon
        using (true)
        with check (true);
      $p$, t);
    end if;
  end loop;
end $$;

-- Realtime: make sure these tables broadcast postgres_changes.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table backfill_matches'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table schedule_entries'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table activity_log';     exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table keywords';         exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table subreddits';       exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table app_state';        exception when duplicate_object then null; end;
  end if;
end $$;

-- ── Seed data ───────────────────────────────────────────────────────────────
-- (The dashboard also seeds these on first load; running here is optional but
--  recommended so the Node scripts have config before the dashboard is opened.)

insert into subreddits (name, url, platform, category, is_watched) values
('r/fatFIRE', 'https://www.reddit.com/r/fatFIRE/', 'Reddit', 'Finance / FIRE', false),
('r/homeswap', 'https://www.reddit.com/r/homeswap/', 'Reddit', 'Home swap', true),
('r/homeexchange', 'https://www.reddit.com/r/homeexchange/', 'Reddit', 'Home swap', true),
('r/homeexchangebyhabiqo', 'https://www.reddit.com/r/homeexchangebyhabiqo/', 'Reddit', 'Home swap', true),
('r/NYCapartments', 'https://www.reddit.com/r/NYCapartments/', 'Reddit', 'Housing', false),
('r/KindredHomeSwap', 'https://www.reddit.com/r/KindredHomeSwap/', 'Reddit', 'Home swap', true),
('r/Shoestring', 'https://www.reddit.com/r/Shoestring/', 'Reddit', 'Budget travel', false),
('r/london', 'https://www.reddit.com/r/london/', 'Reddit', 'Location', false),
('r/TravelHacks', 'https://www.reddit.com/r/TravelHacks/', 'Reddit', 'Travel', true),
('r/ExpatFIRE', 'https://www.reddit.com/r/ExpatFIRE/', 'Reddit', 'Finance / FIRE', false),
('r/digitalnomad', 'https://www.reddit.com/r/digitalnomad/', 'Reddit', 'Digital nomad', true),
('r/travel', 'https://www.reddit.com/r/travel/', 'Reddit', 'Travel', true),
('r/airbnb_hosts', 'https://www.reddit.com/r/airbnb_hosts/', 'Reddit', 'Hosting', false),
('r/trustedhousesitters', 'https://www.reddit.com/r/trustedhousesitters/', 'Reddit', 'Home swap', true),
('r/UKPersonalFinance', 'https://www.reddit.com/r/UKPersonalFinance/', 'Reddit', 'Finance', false),
('r/sustainability', 'https://www.reddit.com/r/sustainability/', 'Reddit', 'Sustainability', false),
('r/expats', 'https://www.reddit.com/r/expats/', 'Reddit', 'Expat', false),
('Digital Nomad Accommodation', 'https://www.facebook.com/groups/325849768974770', 'Facebook', 'Digital nomad', false),
('Digital Nomads', 'https://www.facebook.com/groups/1033016563818566/', 'Facebook', 'Digital nomad', false)
on conflict (name) do nothing;

insert into keywords (keyword) values
('home swap'),
('house swap'),
('home exchange'),
('swap apartment'),
('trade homes'),
('swap homes')
on conflict (keyword) do nothing;

insert into app_state (key, value) values
  ('backfill_mode', '{"mode":"tuning"}'),
  ('schedule_start_date', '{"date":"2026-05-18"}')
on conflict (key) do nothing;
