-- Card-free trial and the signup record.
--
-- users gains what we need to remember about everyone who signs in: the
-- provider's own stable account id, when they accepted the terms (and which
-- version), whether they said yes to product updates and when, and when they
-- last signed in. marketing_opt_in defaults to false, so no one is emailed
-- product updates without having said so; existing accounts are not opted in.
--
-- trial_claims is the one-trial-per-person ledger. It is deliberately not tied
-- to orgs or users by cascade: deleting a workspace, or an account, must not
-- give the same person a fresh trial. A claim is keyed two independent ways —
-- a SHA-256 of the normalized email (identity_key; the ledger outlives the
-- account, so it holds a hash and never the address) and the sign-in provider's account id
-- (provider_subject) — each UNIQUE, so the database itself refuses a second
-- claim for the same person regardless of which code path asks. user_id and
-- org_id are SET NULL on delete for the same reason: the claim outlives them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_account_id TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_opt_in_at TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
--> statement-breakpoint
-- Everyone who already has an account signed up on a form that carried a
-- pre-ticked agreement to the terms. They are recorded as having accepted, at
-- sign-up time and under a version label that says so, so the new terms step
-- (which every account without a recorded acceptance must pass) does not
-- interrupt existing customers. New accounts are never touched by this: the
-- migration runner applies this file once, at deploy time.
UPDATE users SET terms_accepted_at = created_at::timestamptz, terms_version = 'before-consent-record'
WHERE terms_accepted_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS trial_claims (
  id SERIAL PRIMARY KEY,
  identity_key TEXT NOT NULL,
  provider_subject TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  org_id INTEGER REFERENCES orgs(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_trial_claims_identity_key UNIQUE (identity_key),
  CONSTRAINT uq_trial_claims_provider_subject UNIQUE (provider_subject),
  CONSTRAINT trial_claims_ends_after_start CHECK (ends_at > started_at)
);
--> statement-breakpoint
-- Everyone who already has a subscription row has used their trial. Without
-- this, an existing customer could sign in with a second account and be
-- offered another. The key is built the same way as normalizeIdentity() in
-- lib/billing/trial.ts (then hashed with SHA-256): lower-cased, a +tag dropped from the local part, the
-- googlemail.com alias folded to gmail.com, and dots dropped on gmail.com only.
INSERT INTO trial_claims (identity_key, provider_subject, user_id, org_id, started_at, ends_at)
SELECT DISTINCT ON (k.identity_key)
  k.identity_key, k.provider_account_id, k.user_id, k.org_id, k.started_at, k.started_at + interval '14 days'
FROM (
  SELECT
    encode(sha256(convert_to(
      CASE
        WHEN d.domain = 'gmail.com' THEN replace(d.local_part, '.', '')
        ELSE d.local_part
      END || '@' || d.domain, 'UTF8')), 'hex') AS identity_key,
    d.provider_account_id, d.user_id, d.org_id, d.started_at
  FROM (
    SELECT
      split_part(split_part(lower(btrim(u.email)), '@', 1), '+', 1) AS local_part,
      CASE WHEN split_part(lower(btrim(u.email)), '@', 2) = 'googlemail.com'
        THEN 'gmail.com' ELSE split_part(lower(btrim(u.email)), '@', 2) END AS domain,
      u.provider_account_id, u.id AS user_id, s.org_id, s.created_at::timestamptz AS started_at
    FROM subscriptions s
    JOIN memberships m ON m.org_id = s.org_id AND m.role = 'owner'
    JOIN users u ON u.id = m.user_id
    WHERE u.email IS NOT NULL AND position('@' in u.email) > 1
  ) d
  WHERE d.local_part <> '' AND d.domain <> ''
) k
ORDER BY k.identity_key, k.started_at
ON CONFLICT DO NOTHING;
