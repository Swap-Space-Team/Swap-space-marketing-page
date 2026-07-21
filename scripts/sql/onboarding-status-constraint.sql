-- Widen the application_status CHECK constraint to admit the onboarding ladder.
--
-- REQUIRED: without this, every poll that tries to advance someone fails with
--   23514 new row for relation "applications" violates check constraint
--        "applications_application_status_check"
-- Postgres rejects the row, the update matches nothing, and the applicant stays
-- on whatever status they had. (The companion migration onboarding-status.sql
-- claimed this column had no check constraint — it does. That comment is fixed.)
--
-- The list below is every value the application can produce today: the pre-approval
-- flow in api/submit-application.js and api/upload-images.js, the admin decisions in
-- api/admin.js, the onboarding ladder from check-onboarding-status, plus the two
-- legacy labels ('Completed', 'Welcome Sent') that nothing writes any more but that
-- existing rows still carry. Dropping a value that rows still hold would make the
-- ALTER fail, so keep the legacy entries until those rows are migrated off them.
--
-- Run in the Supabase SQL editor (or psql) against the project database.

ALTER TABLE applications
  DROP CONSTRAINT IF EXISTS applications_application_status_check;

ALTER TABLE applications
  ADD CONSTRAINT applications_application_status_check
  CHECK (application_status IN (
    -- pre-approval
    'Application Received',
    'Photos Requested',
    'Photos Received',
    -- admin decision
    'Approved',
    'Rejected',
    -- post-approval onboarding, driven by check-onboarding-status
    'Registered',
    'Listing Started',
    'Listing Completed',
    -- legacy, retained so existing rows validate
    'Welcome Sent',
    'Completed'
  ));

-- Sanity check — should return zero rows before you run the ALTER above. If it
-- returns anything, add those values to the list rather than letting the ALTER fail.
--
--   SELECT DISTINCT application_status FROM applications
--   WHERE application_status NOT IN (
--     'Application Received','Photos Requested','Photos Received','Approved',
--     'Rejected','Registered','Listing Started','Listing Completed',
--     'Welcome Sent','Completed'
--   );
