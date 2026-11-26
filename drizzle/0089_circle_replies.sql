-- Circle replies (lib/circle/send.ts, app/api/circle/webhook/route.ts).
--
-- bot_user_id holds the Circle member id that answerLoops's comments are
-- posted as, read from Circle's reply when a comment is created. The webhook
-- uses it to recognise those comments when Circle sends them back. NULL until
-- the first comment is posted, and cleared when the "post replies as" member
-- changes.
-- team_member_ids holds a JSON array of Circle member ids whose comments are
-- kept on the ticket as thread context instead of opening a ticket.
--
-- Both columns are nullable with no default, so existing rows are untouched.
-- Every statement can be applied twice.

ALTER TABLE integrations ADD COLUMN IF NOT EXISTS bot_user_id TEXT;
--> statement-breakpoint
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS team_member_ids TEXT;
