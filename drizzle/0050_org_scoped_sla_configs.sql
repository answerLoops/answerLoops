-- SLA targets become per-org.
--
-- sla_configs used to hold one row per priority shared by every workspace.
-- Existing rows are kept untouched and now act as the global defaults
-- (org_id IS NULL); a workspace that saves its own targets gets its own row
-- (org_id set), and lookups fall back to the default row for any priority the
-- workspace has not customised.

ALTER TABLE sla_configs ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES orgs(id) ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE sla_configs DROP CONSTRAINT IF EXISTS sla_configs_priority_unique;
--> statement-breakpoint

-- One row per (org, priority) for workspace overrides, and one row per
-- priority among the NULL-org defaults (a plain composite unique would treat
-- NULL org ids as distinct and allow duplicate defaults).
CREATE UNIQUE INDEX IF NOT EXISTS sla_configs_org_priority_unique
  ON sla_configs (org_id, priority)
  WHERE org_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sla_configs_default_priority_unique
  ON sla_configs (priority)
  WHERE org_id IS NULL;
--> statement-breakpoint

-- Make sure every priority has a global default so tickets always get
-- deadlines; existing default rows are left as they are.
INSERT INTO sla_configs (org_id, priority, response_hours, resolve_hours)
SELECT NULL, v.priority, v.response_hours, v.resolve_hours
FROM (VALUES
  ('critical', 1, 4),
  ('high', 4, 24),
  ('medium', 24, 72),
  ('low', 72, 168)
) AS v(priority, response_hours, resolve_hours)
WHERE NOT EXISTS (
  SELECT 1 FROM sla_configs c WHERE c.org_id IS NULL AND c.priority = v.priority
);
