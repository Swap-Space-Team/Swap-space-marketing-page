-- Onboarding / listing progress — additive schema change.
--
-- Lets the admin panel track an applicant PAST the "logged in" point: whether
-- they've started listing a property and whether they've finished. The coarse
-- label still lives in `applications.application_status` (a plain text column, no
-- enum/check — new values like 'Listing Started' store as-is). These columns keep
-- the richer raw signal returned by BACKEND_URL/api/internal/onboarding-status so
-- we don't lose it behind the coarse status.
--
-- Nothing is dropped or repurposed, so rolling back the application code never
-- requires reverting this migration. Safe to run before deploying.
--
-- Run in the Supabase SQL editor (or psql) against the project database.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS listing_status            text,        -- 'none' | 'started' | 'completed' (raw from backend)
  ADD COLUMN IF NOT EXISTS listing_count             integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS logged_in_at              timestamptz, -- first time the backend reported passwordChanged=true
  ADD COLUMN IF NOT EXISTS listing_status_checked_at timestamptz; -- last time we polled the backend for this row
