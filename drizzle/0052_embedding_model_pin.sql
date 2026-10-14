-- Each workspace is pinned to the embedding model its stored vectors belong
-- to, so a model change (on the platform or in the workspace's own settings)
-- never mixes vectors from two models in one search. A background job
-- re-embeds into the *_next staging columns and switches the pin when done.

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS embedding_model_in_use text;
--> statement-breakpoint
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS embedding_next text;
--> statement-breakpoint
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS embedding_vec_next vector(1536);
--> statement-breakpoint
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS model_next text;
--> statement-breakpoint
ALTER TABLE ticket_embeddings ADD COLUMN IF NOT EXISTS vector_next text;
--> statement-breakpoint
ALTER TABLE ticket_embeddings ADD COLUMN IF NOT EXISTS model_next text;
--> statement-breakpoint

-- Existing vectors were made with the workspace's own embedding model when it
-- had its own embedding config, and with the platform default otherwise.
UPDATE orgs o SET embedding_model_in_use = COALESCE(
  (SELECT NULLIF(c.embedding_model, '') FROM ai_configs c
    WHERE c.org_id = o.id
      AND (c.embedding_base_url IS NOT NULL
        OR c.embedding_api_key IS NOT NULL
        OR (c.chat_provider = 'openai' AND c.chat_api_key IS NOT NULL))
    LIMIT 1),
  'text-embedding-3-small')
WHERE o.embedding_model_in_use IS NULL;
--> statement-breakpoint

-- Rows were stamped with a constant regardless of the model used; align them
-- with the pin so search can filter on it.
UPDATE kb_articles a SET model = o.embedding_model_in_use FROM orgs o WHERE a.org_id = o.id AND a.model IS DISTINCT FROM o.embedding_model_in_use;
--> statement-breakpoint
UPDATE ticket_embeddings te SET model = o.embedding_model_in_use FROM tickets t JOIN orgs o ON o.id = t.org_id WHERE te.ticket_id = t.id AND te.model IS DISTINCT FROM o.embedding_model_in_use;
