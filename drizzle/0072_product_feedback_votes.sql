-- Up-votes on the in-app product feedback board. A vote is a row: one per
-- person per approved entry, nothing else — there is no direction column
-- because the board has no down-vote. Counts are computed at read time from
-- this table; nothing is denormalized onto product_feedback.
--
-- org_id is the VOTER's workspace. The board is shared across workspaces, so a
-- person can vote on another workspace's entry; when their workspace is
-- permanently deleted, the votes they cast go with it (same rule as the
-- feedback they submitted), which the cascade and hardPurgeOrg both enforce.

CREATE TABLE IF NOT EXISTS product_feedback_votes (
  id SERIAL PRIMARY KEY,
  feedback_id INTEGER NOT NULL REFERENCES product_feedback(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT now(),
  CONSTRAINT product_feedback_votes_unique UNIQUE (feedback_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_product_feedback_votes_feedback ON product_feedback_votes (feedback_id);

-- Same wake-up as the board itself (function defined in 0046): a vote changes
-- a count every connected dashboard is showing, so every stream re-fetches.
DROP TRIGGER IF EXISTS trg_product_feedback_votes_changed ON product_feedback_votes;
CREATE TRIGGER trg_product_feedback_votes_changed
  AFTER INSERT OR UPDATE OR DELETE ON product_feedback_votes
  FOR EACH ROW EXECUTE FUNCTION notify_product_feedback_changed();
