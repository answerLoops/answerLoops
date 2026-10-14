-- Re-embed job bookkeeping per workspace (lib/kb/embedding-migration.ts).
-- The lease is a row, not a session advisory lock, so it holds across the
-- connection pool; the attempt time and failure count let workspaces that
-- keep failing back off instead of taking every sweep's slots.

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS embedding_migration_lease_until timestamptz;
--> statement-breakpoint
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS embedding_migration_attempted_at timestamptz;
--> statement-breakpoint
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS embedding_migration_failures integer NOT NULL DEFAULT 0;
