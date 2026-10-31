-- Per-org widget lead-capture behavior — see GitHub issue #11 and
-- lib/widget/lead-capture.ts for the three valid values. Defaults every
-- existing workspace to 'up-front', matching the hardcoded gate they already
-- had, so this column cannot silently change a live widget's behavior. A
-- brand-new workspace gets the improved 'on-failure' default instead, set
-- explicitly at org creation in auth.ts rather than relying on this column
-- default.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_lead_capture_mode TEXT NOT NULL DEFAULT 'up-front';
