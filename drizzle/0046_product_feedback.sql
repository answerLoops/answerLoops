-- In-app product feedback board + product updates feed. Shown to every
-- signed-in user in every org through the dashboard's floating feedback
-- widget. Feedback is moderated: a row is only visible to other users once an
-- operator approves it. Updates are authored by operators only.
--
-- These tables are intentionally NOT tenant-scoped for reads — the board is a
-- shared surface — so org_id records the author's workspace for display and
-- audit, never as a read filter.

CREATE TABLE IF NOT EXISTS product_feedback (
  id SERIAL PRIMARY KEY,
  -- NULL org/user only for seeded example rows, which have no real author.
  org_id INTEGER REFERENCES orgs(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  -- Display override. When set it replaces the "<workspace> user feedback" label.
  author_label TEXT,
  body TEXT NOT NULL,
  anonymous INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_at TEXT,
  reply_body TEXT,
  reply_tag TEXT,
  replied_at TEXT,
  created_at TEXT NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE product_feedback ADD CONSTRAINT product_feedback_status_check CHECK (status IN ('pending', 'approved', 'rejected'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_feedback_status ON product_feedback (status, created_at);
CREATE INDEX IF NOT EXISTS idx_product_feedback_user ON product_feedback (user_id);

CREATE TABLE IF NOT EXISTS product_updates (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT NOT NULL DEFAULT now(),
  created_at TEXT NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_updates_published ON product_updates (published_at);

-- Wakes every connected dashboard when the board changes. The payload is empty
-- on purpose: unlike data_changed (one tenant's rows), the board is global, so
-- the SSE endpoint forwards it to every stream and clients re-fetch.
CREATE OR REPLACE FUNCTION notify_product_feedback_changed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('product_feedback_changed', '');
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_product_feedback_changed ON product_feedback;
CREATE TRIGGER trg_product_feedback_changed
  AFTER INSERT OR UPDATE OR DELETE ON product_feedback
  FOR EACH ROW EXECUTE FUNCTION notify_product_feedback_changed();

DROP TRIGGER IF EXISTS trg_product_updates_changed ON product_updates;
CREATE TRIGGER trg_product_updates_changed
  AFTER INSERT OR UPDATE OR DELETE ON product_updates
  FOR EACH ROW EXECUTE FUNCTION notify_product_feedback_changed();
