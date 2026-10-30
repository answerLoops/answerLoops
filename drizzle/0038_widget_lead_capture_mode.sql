-- Per-org widget lead-capture behavior. Default is 'on-failure' rather than
-- the hardcoded up-front email gate the widget shipped with — see GitHub
-- issue #11 and lib/widget/lead-capture.ts for the three valid values.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_lead_capture_mode TEXT NOT NULL DEFAULT 'on-failure';
