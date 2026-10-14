-- Per-integration shared secrets are matched by SHA-256 digest instead of by
-- the stored value, and Google Chat's one-time /connect code moves into its
-- own columns with an expiry.
--
-- bot_secret_hash : hex SHA-256 of the secret; inbound requests are resolved
--                   by hashing the presented value and matching this column.
-- bot_secret_enc  : the same secret encrypted at rest, for platforms that must
--                   read it back (Telegram setWebhook secret_token, Discourse
--                   and Circle webhook configuration, the bot process).
-- pairing_code_*  : Google Chat /connect code (digest, encrypted copy for the
--                   settings page, expiry). Cleared when pairing completes.
--
-- The legacy plaintext bot_secret column stays in place and is emptied row by
-- row: rows are hashed here, then re-encrypted into bot_secret_enc the first
-- time the application reads them.

ALTER TABLE integrations ADD COLUMN IF NOT EXISTS bot_secret_hash TEXT;
--> statement-breakpoint
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS bot_secret_enc TEXT;
--> statement-breakpoint
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS pairing_code_hash TEXT;
--> statement-breakpoint
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS pairing_code_enc TEXT;
--> statement-breakpoint
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS pairing_code_expires_at TEXT;
--> statement-breakpoint

-- Pending Google Chat pairings (never paired): move the code to its own
-- columns with a fresh 24h window. The plaintext copy is carried over only so
-- the settings page can keep displaying it until it is used or expires.
UPDATE integrations
SET pairing_code_hash = encode(sha256(convert_to(bot_secret, 'UTF8')), 'hex'),
    pairing_code_enc = bot_secret,
    pairing_code_expires_at = to_char((now() + interval '24 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    bot_secret = NULL
WHERE platform = 'google_chat'
  AND bot_secret IS NOT NULL
  AND team_id IS NULL;
--> statement-breakpoint

-- Paired Google Chat rows do not use a shared secret at all.
UPDATE integrations
SET bot_secret = NULL
WHERE platform = 'google_chat'
  AND bot_secret IS NOT NULL;
--> statement-breakpoint

UPDATE integrations
SET bot_secret_hash = encode(sha256(convert_to(bot_secret, 'UTF8')), 'hex')
WHERE bot_secret IS NOT NULL
  AND bot_secret_hash IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS integrations_bot_secret_hash_unique ON integrations (bot_secret_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS integrations_pairing_code_hash_unique ON integrations (pairing_code_hash);
