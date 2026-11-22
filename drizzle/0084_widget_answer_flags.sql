-- A visitor's verdict on one widget answer (Pro and above): a thumbs-down with
-- an optional reason and note, kept so a team member can see which answer was
-- wrong, what it was based on, and act on it. See lib/db/queries/widget-answer-flags.ts
-- and app/api/widget/flag/route.ts.
--
-- One row per answer. The question, answer and note are personal-data-scrubbed
-- before they are stored and are cleared 90 days after the flag was made (or at
-- once when it is dismissed); the row, the reason and the cited article ids stay.
-- Ordinary answer records still hold no question or answer text.
--
-- cited_article_ids is copied from the answer's recorded references when the flag
-- is made. answer_id is nulled, not cascaded, when the answer record is pruned, so
-- an unreviewed flag is never deleted along with it.
--
-- A new table, so nothing changes for an existing widget. The statements can be
-- applied twice.
CREATE TABLE IF NOT EXISTS widget_answer_flags (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  answer_id UUID REFERENCES kb_answers(id) ON DELETE SET NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('up', 'down')),
  reason TEXT CHECK (reason IN ('wrong_information', 'outdated', 'did_not_answer', 'other')),
  note TEXT,
  question TEXT NOT NULL DEFAULT '',
  answer TEXT NOT NULL DEFAULT '',
  cited_article_ids INTEGER[] NOT NULL DEFAULT '{}',
  lead_id INTEGER REFERENCES widget_leads(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_widget_answer_flags_answer ON widget_answer_flags (answer_id) WHERE answer_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_widget_answer_flags_org_status ON widget_answer_flags (org_id, status, created_at DESC);
