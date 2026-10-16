-- KB sync queue hardening.
--
-- 1. The one-active-job index now includes org_id, so the debounce is scoped
--    to a workspace. Dropped and recreated (IF EXISTS / IF NOT EXISTS) so the
--    migration can be re-run safely.
-- 2. Running jobs carry a heartbeat. The sweep reclaims a job only once its
--    heartbeat has gone stale, rather than on how long ago it started, so a
--    long but healthy sync is never handed to a second worker.
-- 3. not_before lets a follow-up run wait out a short cooldown, and
--    rerun_requested records that another trigger arrived while the job was
--    running, so the finish step queues exactly one follow-up run.
-- 4. Staging markers for the embedding re-index: a staged vector records a
--    fingerprint of the text it was built from, and is only promoted while
--    that text is unchanged.

ALTER TABLE kb_sync_jobs ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;
--> statement-breakpoint
ALTER TABLE kb_sync_jobs ADD COLUMN IF NOT EXISTS not_before timestamptz;
--> statement-breakpoint
ALTER TABLE kb_sync_jobs ADD COLUMN IF NOT EXISTS rerun_requested boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Jobs already running when this ships get a heartbeat so the new reclaim rule
-- measures them from now rather than treating them as stale immediately.
UPDATE kb_sync_jobs SET heartbeat_at = now() WHERE status = 'running' AND heartbeat_at IS NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS kb_sync_jobs_one_active;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS kb_sync_jobs_one_active
  ON kb_sync_jobs (org_id, kind, COALESCE(repo_id, 0))
  WHERE status IN ('queued', 'running');
--> statement-breakpoint
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS embedding_next_hash text;
--> statement-breakpoint
ALTER TABLE ticket_embeddings ADD COLUMN IF NOT EXISTS vector_next_hash text;
