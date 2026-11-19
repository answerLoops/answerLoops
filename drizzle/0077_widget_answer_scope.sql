-- What the website chat widget may answer from, and an optional note from the
-- workspace owner on tone and next steps. See lib/widget/answer-scope.ts.
--
-- widget_answer_scope defaults every existing workspace to 'general', the
-- behaviour every widget had before this column existed (answer from the
-- knowledge base, and from general knowledge when it has nothing), so adding
-- the column cannot change what a live widget says. 'knowledge-base-only' is
-- opt-in per workspace.
--
-- widget_guidance is free text, NULL meaning none. Its length is enforced where
-- it is written (normalizeWidgetGuidance), not here, so the limit can change
-- without a migration.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_answer_scope TEXT NOT NULL DEFAULT 'general';
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_guidance TEXT;
