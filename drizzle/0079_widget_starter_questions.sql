-- Short questions a workspace on Pro or above shows as tappable buttons when
-- its website chat opens, and a switch to hide them without deleting them.
-- The questions are plain text, one per line, at most four. See
-- lib/widget/appearance.ts.
--
-- Both columns are NULL by default: no questions, and NULL on the switch means
-- on (only an explicit false hides the buttons). Adding them cannot change any
-- live widget. The count and length limits are enforced where the values are
-- written (normalizeStarterQuestions) and again where they are read, not here,
-- so a limit can change without a migration.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_starter_questions TEXT;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_starter_enabled BOOLEAN;
