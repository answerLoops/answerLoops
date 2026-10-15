-- How many answers each knowledge-base article was supplied to as context.
-- One row per article per UTC day, so a total and a recent window are cheap to
-- read and the table grows with articles x days, never with traffic. Only a
-- count is stored: no question text, no visitor or ticket reference.
-- Row-level security is switched on for every public table by lib/db/migrate.ts.

CREATE TABLE IF NOT EXISTS kb_article_usage (
  article_id INTEGER NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  answers INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, day)
);

CREATE INDEX IF NOT EXISTS idx_kb_article_usage_org_day ON kb_article_usage (org_id, day);
