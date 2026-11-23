-- Docs folders for a repository's knowledge base sync (lib/github/doc-folders.ts).
--
-- kb_paths holds the folders an owner picked; NULL means none were picked and
-- the sync reads every Markdown file in the repository, as before.
-- kb_sync_result holds the last files sync's counts (synced, skipped because
-- the knowledge base is full, unreadable, too large) and any chosen folder
-- that no longer exists, shown on the repo row. NULL until a sync records one.
--
-- Both columns are nullable with no default, so existing rows are untouched.
-- Every statement can be applied twice.

ALTER TABLE github_repos ADD COLUMN IF NOT EXISTS kb_paths TEXT[];
--> statement-breakpoint
ALTER TABLE github_repos ADD COLUMN IF NOT EXISTS kb_sync_result JSONB;
