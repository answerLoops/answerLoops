-- When a sync last changed documentation related to a saved resolution, and
-- which source it was. A resolution shows a notice while this date is later
-- than both its last save and its last verification, so neither re-saving nor
-- verifying needs to clear anything here.
--
-- Nullable: nothing has been flagged until the next sync that changes docs
-- near a resolution.
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS docs_changed_at TEXT;
--> statement-breakpoint
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS docs_changed_source TEXT;
