-- Lets a ticket hold the whole conversation it came from, on any channel.
-- A message that continues a conversation is stored as a row here, labeled by
-- who wrote it (the customer, a staff member, or a maintainer whose message is
-- kept for context only), and tagged with the id the channel gave it so the
-- same delivery is never stored twice and a later reply to this message finds
-- its ticket. Existing rows keep their meaning: inbound replies were all
-- recorded under the name 'Customer', everything else was written by staff.

ALTER TABLE ticket_replies
  ADD COLUMN IF NOT EXISTS author_role TEXT NOT NULL DEFAULT 'staff'
    CHECK (author_role IN ('staff', 'customer', 'context'));
--> statement-breakpoint
ALTER TABLE ticket_replies
  ADD COLUMN IF NOT EXISTS source_message_id TEXT;
--> statement-breakpoint
UPDATE ticket_replies SET author_role = 'customer' WHERE staff_name = 'Customer' AND author_role = 'staff';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ticket_replies_ticket_source_message_unique
  ON ticket_replies (ticket_id, source_message_id) WHERE source_message_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ticket_replies_source_message ON ticket_replies (source_message_id) WHERE source_message_id IS NOT NULL;
