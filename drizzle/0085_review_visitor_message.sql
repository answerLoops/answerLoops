-- The visitor's own words on a widget review item, kept beside the question
-- when the question is the assistant's standalone rewrite of a follow-up
-- ("Team plan price" for "and for teams?"). See lib/kb/review-capture.ts.
--
-- Null for every other item, including all existing ones, so nothing changes
-- for them. Personal-data-scrubbed before it is stored, and cleared on the
-- same schedule as the question and answer (purgeExpiredReviewText). The
-- statement can be applied twice.
ALTER TABLE kb_review_items ADD COLUMN IF NOT EXISTS visitor_message TEXT;
