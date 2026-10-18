-- Records why a ticket was routed to a person without an AI draft, so the
-- ticket page can say so accurately instead of always blaming the AI provider.
-- Backfills bug and feature-request tickets, whose reason is fully determined
-- by their category. Email tickets are left alone because an email held for an
-- unverified sender is also a draft-less needs_human ticket and the two cannot
-- be told apart after the fact. Everything else stays null and shows a neutral
-- message. Every statement is idempotent so the migration can be re-run safely.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ai_draft_skip_reason TEXT;
--> statement-breakpoint
UPDATE tickets
SET ai_draft_skip_reason = 'bug_or_feature'
WHERE ai_draft_status = 'needs_human'
  AND ai_draft IS NULL
  AND ai_draft_skip_reason IS NULL
  AND source_platform <> 'email'
  AND category IN ('bug', 'feature_request');
