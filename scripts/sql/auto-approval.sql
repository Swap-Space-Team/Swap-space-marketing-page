-- Geographic auto-approval — additive schema change.
--
-- Adds three nullable/defaulted columns to `applications`. Nothing is dropped or
-- repurposed, so rolling back the application code never requires reverting this
-- migration. Safe to run before deploying the feature (the columns simply stay
-- at their defaults while AUTO_APPROVAL_ENABLED is off).
--
-- Run in the Supabase SQL editor (or psql) against the project database.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS auto_approved boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS region        text,
  ADD COLUMN IF NOT EXISTS country_code  text;
