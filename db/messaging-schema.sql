-- ============================================================================
-- SwapSpace admin messaging (Bird SMS) — Phase 0 schema
-- Run this in the Supabase SQL editor. Safe to re-run (idempotent).
--
-- Access model: these tables are written/read only by server-side code using
-- the SUPABASE_SERVICE_ROLE_KEY (see lib/supabase.js / api/admin.js), which
-- bypasses RLS. We still enable RLS with no policies so the tables are NOT
-- reachable via the public anon key. Admin auth is enforced in api/messaging.js
-- (verifyAdmin), matching the existing admin endpoints.
-- ============================================================================

create extension if not exists "pgcrypto";  -- for gen_random_uuid()

-- ── Persist SMS consent on applications ─────────────────────────────────────
-- The application form's required consent checkbox (smsConsent11) was never
-- stored. api/submit-application.js now writes these on every new submission.
alter table public.applications
  add column if not exists sms_consent    boolean not null default false;
alter table public.applications
  add column if not exists sms_consent_at timestamptz;

-- ── Contacts ────────────────────────────────────────────────────────────────
-- Unified recipient book: applicants, plus numbers you add manually or import.
-- Deduped by E.164 phone. `application_id` links back when the contact came
-- from an application (nullable for manual/imported numbers).
create table if not exists public.messaging_contacts (
  id              uuid primary key default gen_random_uuid(),
  phone           text not null unique,          -- E.164, e.g. +15551234567
  name            text,
  email           text,
  city            text,
  country         text,
  source          text not null default 'manual' -- 'application' | 'manual' | 'import'
                    check (source in ('application', 'manual', 'import')),
  application_id  uuid,                           -- FK-ish ref to applications.id (uuid; loose: no hard FK so imports never fail)
  sms_consent     boolean not null default false, -- captured at application time (smsConsent11)
  sms_consent_at  timestamptz,
  tags            text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists messaging_contacts_source_idx  on public.messaging_contacts (source);
create index if not exists messaging_contacts_country_idx  on public.messaging_contacts (country);

-- ── Opt-outs (suppression list) ─────────────────────────────────────────────
-- Global per-phone suppression. Every send MUST check this first. Populated by
-- inbound STOP/UNSUBSCRIBE (Bird webhook) or manual admin action.
create table if not exists public.messaging_optouts (
  phone         text primary key,                -- E.164
  reason        text not null default 'STOP'     -- 'STOP' | 'manual'
                  check (reason in ('STOP', 'manual')),
  opted_out_at  timestamptz not null default now()
);

-- ── Campaigns ───────────────────────────────────────────────────────────────
-- A bulk send to a filtered audience. Individual sends may leave campaign_id null.
create table if not exists public.messaging_campaigns (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  channel        text not null default 'sms' check (channel in ('sms')),  -- 'whatsapp' added in Phase 2
  body           text not null,
  segment        jsonb not null default '{}'::jsonb,  -- audience filter (status/city/country/source/…)
  status         text not null default 'draft'
                   check (status in ('draft', 'sending', 'sent', 'failed')),
  audience_count integer not null default 0,
  sent_count     integer not null default 0,
  created_by     text,                            -- admin email from verifyAdmin
  created_at     timestamptz not null default now(),
  sent_at        timestamptz
);
create index if not exists messaging_campaigns_status_idx on public.messaging_campaigns (status);

-- ── Message log ─────────────────────────────────────────────────────────────
-- One row per outbound (and inbound) message. Bird message id + delivery status
-- are filled/updated by the Bird webhook.
create table if not exists public.messaging_log (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid references public.messaging_contacts (id) on delete set null,
  phone           text not null,                 -- denormalized so log survives contact deletion
  direction       text not null default 'outbound'
                    check (direction in ('outbound', 'inbound')),
  channel         text not null default 'sms' check (channel in ('sms')),
  body            text,
  bird_message_id text,
  status          text not null default 'queued'  -- queued|sent|delivered|failed|undelivered|received
                    check (status in ('queued','sent','delivered','failed','undelivered','received')),
  error_code      text,
  campaign_id     uuid references public.messaging_campaigns (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists messaging_log_phone_idx        on public.messaging_log (phone);
create index if not exists messaging_log_campaign_idx     on public.messaging_log (campaign_id);
create index if not exists messaging_log_bird_msg_id_idx  on public.messaging_log (bird_message_id);
create index if not exists messaging_log_created_at_idx   on public.messaging_log (created_at desc);

-- ── Lock down: RLS on, no policies (service role bypasses) ───────────────────
alter table public.messaging_contacts  enable row level security;
alter table public.messaging_optouts   enable row level security;
alter table public.messaging_campaigns enable row level security;
alter table public.messaging_log       enable row level security;
