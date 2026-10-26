-- Which knowledge-base articles were supplied to each generated answer, at
-- which revision and in what order. kb_article_usage only counts; this says
-- which answer an article went into, so a team can trace an answer back to its
-- sources. Facts only: nothing here judges whether the reply used an article.
--
-- Minimal by design: identifiers, the channel, the outcome, the revision hash
-- and retrieval rank. No question text, no answer text, no visitor identity and
-- no ticket content. An answer id is supplied by the caller so a retry or a
-- repeated completion callback records the answer once.
--
-- Deleting an article keeps its reference rows with article_id nulled and the
-- stored hash, so a trace is not silently rewritten. Deleting the workspace
-- removes everything. Rows older than the retention window are swept by the bot
-- (lib/db/queries/kb-answers.ts). article_id is nullable, so the one-row-per-
-- article rule is a unique constraint (which allows several NULLs) rather than
-- a primary key. Row-level security is switched on for every public table by
-- lib/db/migrate.ts.

CREATE TABLE IF NOT EXISTS kb_answers (
  id UUID PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  surface TEXT NOT NULL CONSTRAINT kb_answers_surface_check CHECK (surface IN ('widget', 'ticket', 'discord', 'agent_api')),
  outcome TEXT NOT NULL CONSTRAINT kb_answers_outcome_check CHECK (outcome IN ('generated', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kb_answers_org_created ON kb_answers (org_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kb_answers_created ON kb_answers (created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kb_answer_references (
  id SERIAL PRIMARY KEY,
  answer_id UUID NOT NULL REFERENCES kb_answers(id) ON DELETE CASCADE,
  article_id INTEGER REFERENCES kb_articles(id) ON DELETE SET NULL,
  article_content_hash TEXT NOT NULL,
  rank INTEGER NOT NULL,
  score DOUBLE PRECISION,
  CONSTRAINT uq_kb_answer_references_answer_article UNIQUE (answer_id, article_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kb_answer_references_article ON kb_answer_references (article_id, answer_id);
