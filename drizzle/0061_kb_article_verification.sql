-- Explicit verification of a knowledge-base article: a person checked that the
-- answer is still correct. Stored as who, when, and the hash of the question
-- and answer they checked (lib/kb/revision.ts), so the article reads as
-- verified only while its content still matches that hash. Nullable and not
-- backfilled: every existing article reads as never verified. Imports and syncs
-- never write these columns. The verifier is cleared if the user is deleted;
-- the article and its verification date stay.
-- Also lets kb_article_events record the verification as its own event type by
-- widening that table's type check. The constraint is dropped and re-added so
-- the migration is safe to re-run.

ALTER TABLE kb_articles
  ADD COLUMN IF NOT EXISTS verified_at TEXT,
  ADD COLUMN IF NOT EXISTS verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_content_hash TEXT,
  ADD COLUMN IF NOT EXISTS verification_note TEXT;
--> statement-breakpoint
ALTER TABLE kb_article_events DROP CONSTRAINT IF EXISTS kb_article_events_type_check;
--> statement-breakpoint
ALTER TABLE kb_article_events ADD CONSTRAINT kb_article_events_type_check CHECK (type IN ('created', 'promoted', 'edited', 'review_approved', 'review_rejected', 'review_reopened', 'verified'));
