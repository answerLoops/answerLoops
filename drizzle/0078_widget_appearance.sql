-- How a workspace on Pro or above customises its website chat widget: the title
-- in the chat header, the welcome message and a brand color. See
-- lib/widget/appearance.ts.
--
-- All three are NULL by default, meaning the answerLoops look, so adding the
-- columns cannot change any live widget. Length and format are enforced where
-- the values are written (normalizeWidgetTitle, normalizeWidgetWelcome,
-- normalizeBrandColor) and again where they are read, not here, so a limit can
-- change without a migration.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_title TEXT;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_welcome TEXT;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_brand_color TEXT;
