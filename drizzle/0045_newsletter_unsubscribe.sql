-- Unsubscribe support for blog newsletter signups: a real token-based link
-- that marks a subscriber unsubscribed, instead of the confirmation email
-- having a dead "unsubscribe anytime" promise with no route behind it.

ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT;
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS unsubscribed_at TEXT;

-- Existing rows (if any) predate the token column — backfill so the
-- NOT NULL + UNIQUE constraints below can be applied safely. Built-in
-- functions only (no pgcrypto dependency); app code generates the real
-- crypto.randomBytes(32) token for every row created after this migration.
UPDATE newsletter_subscribers
SET unsubscribe_token = md5(random()::text || clock_timestamp()::text || id::text) || md5(random()::text || id::text)
WHERE unsubscribe_token IS NULL;

ALTER TABLE newsletter_subscribers ALTER COLUMN unsubscribe_token SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE newsletter_subscribers ADD CONSTRAINT newsletter_subscribers_unsubscribe_token_unique UNIQUE (unsubscribe_token);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_token ON newsletter_subscribers (unsubscribe_token);
