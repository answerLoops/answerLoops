-- The question a visitor couldn't get answered, attached to the lead when it
-- comes from the widget's on-failure prompt. Nullable: an up-front-gate lead
-- is collected before any question is asked, so it has none.
ALTER TABLE widget_leads ADD COLUMN IF NOT EXISTS question TEXT;
