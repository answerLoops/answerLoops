-- Tracks when the Telegram webhook was last successfully registered with
-- Telegram's setWebhook API, so the Integrations UI can show a confirmed
-- "registered" state instead of always showing the same "Register webhook"
-- CTA regardless of whether registration already succeeded.
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS webhook_registered_at TEXT;
