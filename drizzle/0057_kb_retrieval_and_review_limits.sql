-- Retrieval: every knowledge-base lookup filters on org_id and published
-- before the vector ordering, so a composite index lets the planner narrow to
-- one workspace's published articles cheaply.
-- Review queue: per-day counters so one question cannot raise an item's
-- occurrence count without bound in a single day.
-- Every statement is idempotent so the migration can be re-run safely.

CREATE INDEX IF NOT EXISTS idx_kb_articles_org_published ON kb_articles (org_id, published);
--> statement-breakpoint
ALTER TABLE kb_review_items ADD COLUMN IF NOT EXISTS merge_day DATE;
--> statement-breakpoint
ALTER TABLE kb_review_items ADD COLUMN IF NOT EXISTS merge_day_count INTEGER NOT NULL DEFAULT 0;
