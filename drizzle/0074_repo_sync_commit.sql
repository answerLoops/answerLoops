-- Which commit a connected repo's last files sync reflected. Until now only the
-- time of the last sync was stored, so nobody could tell which version of the
-- docs the knowledge base was built from.
--
-- Nullable: repos synced before this column existed show no commit until their
-- next sync.
ALTER TABLE github_repos ADD COLUMN IF NOT EXISTS kb_synced_commit TEXT;
