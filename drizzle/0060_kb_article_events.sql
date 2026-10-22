-- Append-only history of what happened to knowledge-base articles. One row per
-- event: an article created or promoted, its content edited, and each review
-- decision. Rows are only ever inserted. The content is never copied here, only
-- a hash of the question and answer (lib/kb/revision.ts), so history survives
-- the review-text retention purge and does not duplicate article text.
-- article_id is null for review rejections and reopenings, which happen before
-- an article exists; review_item_id links them to the article once an approval
-- creates it. Deleting an article deletes its history; deleting a user, ticket
-- or review item keeps the event with that reference cleared.
-- Row-level security is switched on for every public table by lib/db/migrate.ts.

CREATE TABLE IF NOT EXISTS kb_article_events (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  article_id INTEGER REFERENCES kb_articles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('created', 'promoted', 'edited', 'review_approved', 'review_rejected', 'review_reopened')),
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  origin TEXT NOT NULL CHECK (origin IN ('manual', 'ticket_promotion', 'review_queue', 'import', 'sync')),
  source_ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  review_item_id INTEGER REFERENCES kb_review_items(id) ON DELETE SET NULL,
  content_hash TEXT,
  created_at TEXT NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kb_article_events_article ON kb_article_events (article_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kb_article_events_review_item ON kb_article_events (review_item_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kb_article_events_org ON kb_article_events (org_id);
