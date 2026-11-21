-- A workspace's chat widget logo (Pro and above): the small, square, re-encoded
-- image the upload step produces, never the original upload. One row per
-- workspace; replacing the logo replaces the row, removing it deletes the row.
-- See lib/images/logo-pipeline.ts and app/api/widget/logo/[id]/route.ts.
--
-- A new table, so nothing changes for an existing widget until an owner uploads
-- a logo. The statement can be applied twice.
CREATE TABLE IF NOT EXISTS widget_logos (
  org_id INTEGER PRIMARY KEY REFERENCES orgs(id),
  content_type TEXT NOT NULL,
  bytes BYTEA NOT NULL,
  etag TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
