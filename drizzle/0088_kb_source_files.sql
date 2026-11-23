-- One row per repository file a docs sync has written (lib/github/kb-sync.ts).
--
-- A sync compares each file's git blob sha and processing version with what
-- it stored last time, so it only touches files that were added, edited,
-- removed, or processed under older cleanup rules. Each section records the
-- file it came from (kb_articles.source_file_id), so one file's sections can
-- be replaced on their own. Removing a file row removes its sections, and
-- removing a source removes its file rows.
--
-- Sources synced before this table existed have no rows; their next sync
-- rebuilds them once and writes the rows.
--
-- kb_sync_jobs.reprocess_only marks a sync queued in the background to bring
-- docs up to the current cleanup rules (lib/github/docs-reprocess.ts). Such a
-- job only re-processes, and is claimed after syncs a person or a push queued.
-- Every statement can be applied twice.

CREATE TABLE IF NOT EXISTS kb_source_files (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  blob_sha TEXT NOT NULL,
  title TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  processing_version INTEGER NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (now()::text),
  UNIQUE (source_id, path)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kb_source_files_org ON kb_source_files (org_id);
--> statement-breakpoint
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS source_file_id INTEGER REFERENCES kb_source_files(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kb_articles_source_file ON kb_articles (source_file_id);
--> statement-breakpoint
ALTER TABLE kb_sync_jobs ADD COLUMN IF NOT EXISTS reprocess_only BOOLEAN NOT NULL DEFAULT false;
