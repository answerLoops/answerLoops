-- Re-titling sections from earlier page imports (lib/kb/retitle-imports.ts).
--
-- Sections imported from a web page are titled with the page and the heading
-- ("pricing › Pro"). Pages imported before that change hold the heading alone
-- ("Pro"); that change was live in production from 2026-11-23 04:09:45 UTC.
-- titles_version marks which URL sources still need the page added:
-- 0 means not yet, 1 means done or never needed. Every non-URL source starts
-- at 1, and so does a URL source imported after the change whose sections
-- already carry the page. A self-hosted install upgrades on its own schedule,
-- so the date alone can't say which code imported a page; the titles can.
-- Every other URL source starts at 0 and is re-titled. The default moves
-- to 1 before that backfill, so a source created while this runs (the runner
-- applies statements one at a time) is never left at 0.
--
-- The orgs columns are the background pass's bookkeeping, the same shape as
-- the re-embed job's: a lease held while a pass runs, when it last ran, and
-- how many passes in a row failed, so a failing workspace backs off.
--
-- Nothing is deleted. Every statement can be applied twice.

ALTER TABLE kb_sources ADD COLUMN IF NOT EXISTS titles_version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE kb_sources ALTER COLUMN titles_version SET DEFAULT 1;
--> statement-breakpoint
UPDATE kb_sources s SET titles_version = 1
  WHERE s.titles_version = 0 AND (
    s.file_type <> 'url'
    OR (s.created_at::timestamptz >= '2026-11-23T04:09:45Z'
        AND EXISTS (SELECT 1 FROM kb_articles a WHERE a.source_id = s.id AND a.org_id = s.org_id AND a.question LIKE '% › %'))
  );
--> statement-breakpoint
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS kb_retitle_lease_until timestamptz;
--> statement-breakpoint
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS kb_retitle_attempted_at timestamptz;
--> statement-breakpoint
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS kb_retitle_failures integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kb_sources_retitle_pending ON kb_sources (org_id) WHERE file_type = 'url' AND titles_version = 0;
