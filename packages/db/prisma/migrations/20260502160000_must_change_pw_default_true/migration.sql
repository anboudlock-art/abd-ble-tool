-- v2.7: switch must_change_password default to true so new users created
-- via /companies and /users force a first-login password change.
-- Existing rows are NOT touched.
ALTER TABLE "user" ALTER COLUMN "must_change_password" SET DEFAULT true;
