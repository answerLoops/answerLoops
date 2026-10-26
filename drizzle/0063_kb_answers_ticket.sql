-- Lets an answer record say which support ticket it was drafted for, so the
-- ticket page can show the sources behind its draft. Only an opaque ticket id
-- is stored, set for the ticket surface and nowhere else: no ticket content.
-- If the ticket is deleted the answer record stays and the link is cleared.
-- Nullable and not backfilled, so every answer recorded before this has no
-- ticket and the ticket page shows nothing for it.

ALTER TABLE kb_answers
  ADD COLUMN IF NOT EXISTS ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kb_answers_ticket ON kb_answers (ticket_id, created_at);
