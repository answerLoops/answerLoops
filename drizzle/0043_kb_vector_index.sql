-- KB search (searchArticles in lib/db/queries/kb.ts) used to load every
-- published article for an org and score cosine similarity in application
-- JS — a full-table scan on the most-called AI path in the product (search,
-- FAQ answers, chat all route through it). This adds a real pgvector ANN
-- index so the DB does the search directly.
--
-- pgvector is now a hard prerequisite, the same tier as Postgres itself —
-- see content/docs/self-hosting/environment-variables.mdx's Prerequisites
-- section. Local/self-hosted Docker Compose now runs the pgvector/pgvector
-- image; managed providers (Neon, Supabase, RDS 15+) support `CREATE
-- EXTENSION vector` natively.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

-- Mirrors the existing `embedding` text column (kept as-is, still the
-- source of truth for anything that isn't the indexed search path) as a
-- real vector. Dimension is fixed platform-wide at 1536 — see
-- lib/db/schema.ts's comment on this column for why, and
-- lib/ai/embed.ts's KB_EMBEDDING_DIMENSIONS.
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS embedding_vec vector(1536);
--> statement-breakpoint

-- One-time backfill for existing rows. `embedding` was always written as
-- JSON.stringify(number[]) — e.g. "[0.1,0.2,...]" — which is also a valid
-- pgvector text literal, so the cast is direct. Only rows whose stored
-- array is actually 1536-long are backfilled; anything else (a pre-existing
-- row from a custom, non-default embedding_model) is left NULL and simply
-- excluded from vector search going forward rather than corrupting the
-- index with a wrong-dimension value.
UPDATE kb_articles
SET embedding_vec = embedding::vector
WHERE embedding_vec IS NULL
  AND jsonb_array_length(embedding::jsonb) = 1536;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_kb_articles_embedding_vec
  ON kb_articles USING hnsw (embedding_vec vector_cosine_ops);
