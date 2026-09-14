-- Title of the doc/page currently being embedded by a running KB sync job,
-- so the UI can show "Syncing: <title> (N/M)" instead of just a bare count.
-- Nullable: only Notion syncs set it today (the title is already resolved
-- in its sync loop); GitHub file/discussion syncs leave it null and the UI
-- falls back to the plain "Syncing N/M" label.

ALTER TABLE kb_sync_jobs ADD COLUMN IF NOT EXISTS current_item TEXT;
