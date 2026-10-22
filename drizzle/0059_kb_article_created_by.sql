-- Records which team member added a knowledge-base article: written by hand,
-- promoted from a ticket, or approved from the review queue. Nullable and not
-- backfilled, so null means unknown (every article that existed before this
-- migration) or automated (imports and syncs, which carry source_id). The
-- column is cleared if the user is deleted; the article stays.

ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
