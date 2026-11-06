-- The unique constraint on (feedback_id, user_id) from 0072 is backed by a
-- unique index whose leading column is feedback_id, so Postgres already uses it
-- for every lookup by feedback_id alone. The separate single-column index
-- added the same coverage and cost an extra index write on every vote. 0072
-- is left as it was because it has already run in deployed environments.
--
-- IF EXISTS makes this safe to run on a database where the index was never
-- created or was already dropped.
DROP INDEX IF EXISTS idx_product_feedback_votes_feedback;
