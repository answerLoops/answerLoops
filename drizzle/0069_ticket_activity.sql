-- Tracks customer activity on each ticket so a reply to an old conversation can
-- be noticed: when anything last happened, when the customer last wrote, and
-- when the team last opened the ticket. The "last seen" marker is shared by the
-- whole team, like the notifications it clears.
--
-- Existing tickets are marked seen at the moment of migration, so history does
-- not show up as new activity; only replies that arrive afterwards do.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS last_customer_reply_at TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
--> statement-breakpoint
UPDATE tickets t
SET
  last_customer_reply_at = date_trunc('milliseconds', (
    SELECT max(r.created_at::timestamptz) FROM ticket_replies r
    WHERE r.ticket_id = t.id AND r.author_role = 'customer'
  )),
  last_activity_at = date_trunc('milliseconds', GREATEST(
    t.created_at::timestamptz,
    COALESCE((SELECT max(r.created_at::timestamptz) FROM ticket_replies r WHERE r.ticket_id = t.id), t.created_at::timestamptz)
  )),
  last_seen_at = date_trunc('milliseconds', now())
WHERE t.last_activity_at IS NULL;
--> statement-breakpoint
ALTER TABLE tickets ALTER COLUMN last_activity_at SET DEFAULT date_trunc('milliseconds', now());
--> statement-breakpoint
ALTER TABLE tickets ALTER COLUMN last_activity_at SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tickets_org_last_activity ON tickets (org_id, last_activity_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notifications_org_created ON notifications (org_id, created_at DESC);
