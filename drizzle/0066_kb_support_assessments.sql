-- Source support: where an assessment of "does a supplied article support this
-- answer" is stored, with the automated findings, the human flags on them, the
-- per-workspace switches, and evidence that can expire on its own. Storage
-- only: nothing writes or reads these tables until the runner and the
-- dashboard are built, and every switch below defaults to off.
--
-- One row per answer and method version (kb_support_assessments) holds how the
-- run went: completed, failed or skipped, and why. Under it, one finding per
-- supplied article (kb_support_article_findings) and one per claim the judge
-- tied to a passage (kb_support_claim_findings). An answer with no supplied
-- article has an assessment and no findings, which is how "checked, nothing to
-- support it" differs from "never checked". A pair with no finding row is not
-- assessed.
--
-- There is no second retention clock. Assessments cascade from their answer
-- (kb_answers, swept after the single window in lib/kb/coverage.ts) and
-- findings cascade from the reference row of the article they are about, which
-- is also what keeps a finding when its article is deleted: the reference row
-- stays (article_id nulled) and so does the revision hash stored here. The
-- idempotency key is the answer plus the method version, never an article id,
-- because deleting an article nulls article_id and NULLs are distinct in a
-- unique key.
--
-- Human flags are their own table and never touch an automated row. Evidence
-- text is bounded, written only for workspaces that turned excerpt storage on
-- (off by default), and removed on its own at its expiry; the finding stays.
-- Row-level security is switched on for every public table by lib/db/migrate.ts.

CREATE TABLE IF NOT EXISTS kb_support_settings (
  org_id INTEGER PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  widget_enabled INTEGER NOT NULL DEFAULT 0 CONSTRAINT kb_support_settings_widget_check CHECK (widget_enabled IN (0, 1)),
  ticket_enabled INTEGER NOT NULL DEFAULT 0 CONSTRAINT kb_support_settings_ticket_check CHECK (ticket_enabled IN (0, 1)),
  discord_enabled INTEGER NOT NULL DEFAULT 0 CONSTRAINT kb_support_settings_discord_check CHECK (discord_enabled IN (0, 1)),
  agent_api_enabled INTEGER NOT NULL DEFAULT 0 CONSTRAINT kb_support_settings_agent_api_check CHECK (agent_api_enabled IN (0, 1)),
  sampling_rate DOUBLE PRECISION CONSTRAINT kb_support_settings_sampling_check CHECK (sampling_rate IS NULL OR (sampling_rate >= 0 AND sampling_rate <= 1)),
  daily_limit INTEGER CONSTRAINT kb_support_settings_daily_check CHECK (daily_limit IS NULL OR daily_limit >= 0),
  excerpt_storage_enabled INTEGER NOT NULL DEFAULT 0 CONSTRAINT kb_support_settings_excerpt_check CHECK (excerpt_storage_enabled IN (0, 1)),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kb_support_assessments (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  answer_id UUID NOT NULL REFERENCES kb_answers(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  method_version INTEGER NOT NULL,
  rubric_version INTEGER NOT NULL,
  execution_state TEXT NOT NULL CONSTRAINT kb_support_assessments_state_check CHECK (execution_state IN ('completed', 'failed', 'skipped')),
  skip_reason TEXT CONSTRAINT kb_support_assessments_skip_reason_check CHECK (skip_reason IS NULL OR skip_reason IN ('disabled', 'not_sampled', 'over_budget', 'over_cap', 'no_claims')),
  fail_reason TEXT CONSTRAINT kb_support_assessments_fail_reason_check CHECK (fail_reason IS NULL OR fail_reason IN ('timeout', 'provider_error', 'no_result', 'interrupted')),
  answer_summary TEXT NOT NULL CONSTRAINT kb_support_assessments_summary_check CHECK (answer_summary IN ('supporting', 'no_support', 'inconclusive', 'not_assessed')),
  judge_model TEXT,
  similarity_floor DOUBLE PRECISION,
  judge_input_tokens INTEGER,
  judge_output_tokens INTEGER,
  embedding_tokens INTEGER,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_kb_support_assessments_answer_method UNIQUE (answer_id, method_version, rubric_version),
  CONSTRAINT kb_support_assessments_reason_matches_state CHECK (
    (execution_state = 'completed' AND skip_reason IS NULL AND fail_reason IS NULL)
    OR (execution_state = 'skipped' AND skip_reason IS NOT NULL AND fail_reason IS NULL)
    OR (execution_state = 'failed' AND fail_reason IS NOT NULL AND skip_reason IS NULL)
  ),
  CONSTRAINT kb_support_assessments_only_completed_concludes CHECK (execution_state = 'completed' OR answer_summary = 'not_assessed')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kb_support_assessments_org_assessed ON kb_support_assessments (org_id, assessed_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kb_support_assessments_assessed ON kb_support_assessments (assessed_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kb_support_article_findings (
  id SERIAL PRIMARY KEY,
  assessment_id INTEGER NOT NULL REFERENCES kb_support_assessments(id) ON DELETE CASCADE,
  reference_id INTEGER NOT NULL REFERENCES kb_answer_references(id) ON DELETE CASCADE,
  article_content_hash TEXT NOT NULL,
  summary TEXT NOT NULL CONSTRAINT kb_support_article_findings_summary_check CHECK (summary IN ('supporting', 'no_support', 'inconclusive')),
  reasons TEXT[] NOT NULL DEFAULT '{}' CONSTRAINT kb_support_article_findings_reasons_check CHECK (reasons <@ ARRAY['off_topic', 'redundant']::text[]),
  shared_with_reference_ids INTEGER[] NOT NULL DEFAULT '{}',
  CONSTRAINT uq_kb_support_article_findings_assessment_reference UNIQUE (assessment_id, reference_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kb_support_article_findings_reference ON kb_support_article_findings (reference_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kb_support_claim_findings (
  id SERIAL PRIMARY KEY,
  article_finding_id INTEGER NOT NULL REFERENCES kb_support_article_findings(id) ON DELETE CASCADE,
  claim_index INTEGER NOT NULL CONSTRAINT kb_support_claim_findings_claim_check CHECK (claim_index >= 1),
  label TEXT NOT NULL CONSTRAINT kb_support_claim_findings_label_check CHECK (label IN ('supports', 'partial', 'contradicts', 'inconclusive')),
  passage_index INTEGER NOT NULL CONSTRAINT kb_support_claim_findings_passage_check CHECK (passage_index >= 1),
  claim_excerpt TEXT CONSTRAINT kb_support_claim_findings_claim_excerpt_check CHECK (claim_excerpt IS NULL OR char_length(claim_excerpt) <= 300),
  passage_excerpt TEXT CONSTRAINT kb_support_claim_findings_passage_excerpt_check CHECK (passage_excerpt IS NULL OR char_length(passage_excerpt) <= 300),
  evidence_expires_at TIMESTAMPTZ,
  CONSTRAINT uq_kb_support_claim_findings_article_claim UNIQUE (article_finding_id, claim_index),
  CONSTRAINT kb_support_claim_findings_text_needs_expiry CHECK ((claim_excerpt IS NULL AND passage_excerpt IS NULL) OR evidence_expires_at IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kb_support_claim_findings_expiry ON kb_support_claim_findings (evidence_expires_at) WHERE claim_excerpt IS NOT NULL OR passage_excerpt IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kb_support_flags (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  article_finding_id INTEGER NOT NULL REFERENCES kb_support_article_findings(id) ON DELETE CASCADE,
  claim_finding_id INTEGER REFERENCES kb_support_claim_findings(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verdict TEXT NOT NULL CONSTRAINT kb_support_flags_verdict_check CHECK (verdict IN ('agree', 'disagree')),
  note TEXT CONSTRAINT kb_support_flags_note_check CHECK (note IS NULL OR char_length(note) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_kb_support_flags_article_user ON kb_support_flags (article_finding_id, user_id) WHERE claim_finding_id IS NULL AND user_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_kb_support_flags_claim_user ON kb_support_flags (claim_finding_id, user_id) WHERE claim_finding_id IS NOT NULL AND user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kb_support_flags_org ON kb_support_flags (org_id, article_finding_id);
