-- Ensure provider-scoped identity uniqueness across OAuth sign-in methods.
--
-- A user's identity under a given provider is uniquely identified by
-- (provider, provider_account_id). To guarantee concurrent requests cannot
-- provision duplicate user accounts for the same provider identity (even if
-- different emails are presented), enforce a unique index.
--
-- Excludes legacy accounts where provider or provider_account_id is NULL so
-- existing pre-migration records remain intact.

DO $$
BEGIN
  IF EXISTS (
    SELECT provider, provider_account_id
    FROM users
    WHERE provider IS NOT NULL AND provider_account_id IS NOT NULL
    GROUP BY provider, provider_account_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot apply uniqueness constraint: duplicate (provider, provider_account_id) identities exist in users table.';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS users_provider_provider_account_id_unique
  ON users (provider, provider_account_id)
  WHERE provider IS NOT NULL AND provider_account_id IS NOT NULL;
