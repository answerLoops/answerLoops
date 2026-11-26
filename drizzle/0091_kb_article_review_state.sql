-- Review state of a knowledge-base article, separate from `published`
-- (lib/kb/review-state.ts). Every existing article starts as 'current', so
-- nothing changes for customers when this runs.
--
--  - 'current': no review state; the article answers customers as before.
--  - 'needs_review': someone asked the team to take another look. The article
--    stays live and keeps answering customers; only the team sees the flag.
--    Also set automatically when a verified article's text changes.
--  - 'superseded': replaced by another article or a documentation link. The
--    article is excluded from every answer (searchArticles and
--    textSearchArticles in lib/db/queries/kb.ts) until it is restored.
--
-- review_state_at and review_state_by say when the current state was set and
-- by whom (cleared if the user is deleted). review_note is the reason given
-- when flagging. A superseded article names at most one replacement: another
-- article in the same workspace or an http(s) link. Deleting the replacement
-- article clears the reference and leaves the article superseded, so it never
-- quietly starts answering customers again.
--
-- Also widens kb_article_events' type check for the new events. The constraint
-- is dropped and re-added so the migration is safe to re-run.

ALTER TABLE kb_articles
  ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'current',
  ADD COLUMN IF NOT EXISTS review_state_at TEXT,
  ADD COLUMN IF NOT EXISTS review_state_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_note TEXT,
  ADD COLUMN IF NOT EXISTS superseded_by_article_id INTEGER REFERENCES kb_articles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_by_url TEXT;
--> statement-breakpoint
ALTER TABLE kb_articles DROP CONSTRAINT IF EXISTS kb_articles_review_state_check;
--> statement-breakpoint
ALTER TABLE kb_articles ADD CONSTRAINT kb_articles_review_state_check CHECK (review_state IN ('current', 'needs_review', 'superseded'));
--> statement-breakpoint
ALTER TABLE kb_articles DROP CONSTRAINT IF EXISTS kb_articles_replacement_check;
--> statement-breakpoint
ALTER TABLE kb_articles ADD CONSTRAINT kb_articles_replacement_check CHECK (
  (superseded_by_article_id IS NULL OR superseded_by_url IS NULL)
  AND (review_state = 'superseded' OR (superseded_by_article_id IS NULL AND superseded_by_url IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kb_articles_org_review_state ON kb_articles (org_id, review_state);
--> statement-breakpoint
ALTER TABLE kb_article_events DROP CONSTRAINT IF EXISTS kb_article_events_type_check;
--> statement-breakpoint
ALTER TABLE kb_article_events ADD CONSTRAINT kb_article_events_type_check CHECK (type IN (
  'created', 'promoted', 'edited', 'review_approved', 'review_rejected', 'review_reopened', 'verified',
  'flagged_for_review', 'auto_flagged_for_review', 'review_flag_cleared', 'superseded', 'restored'
));
