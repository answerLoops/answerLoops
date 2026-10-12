-- Review queue for assistant answers that had no knowledge-base coverage.
-- An item is private to its org and is never searchable or served to a
-- visitor; approving one writes a kb_articles row and links it back here.
-- Row-level security is switched on for every public table by lib/db/migrate.ts.

CREATE TABLE IF NOT EXISTS kb_review_items (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  embedding_vec vector(1536),
  confidence DOUBLE PRECISION,
  occurrences INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  article_id INTEGER REFERENCES kb_articles(id) ON DELETE SET NULL,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE kb_review_items ADD CONSTRAINT kb_review_items_status_check CHECK (status IN ('pending', 'approved', 'rejected'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE kb_review_items ADD CONSTRAINT kb_review_items_source_check CHECK (source IN ('ticket', 'widget'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_kb_review_items_org_status ON kb_review_items (org_id, status, created_at);
