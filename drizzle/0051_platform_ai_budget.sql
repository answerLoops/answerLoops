-- Included platform AI usage per workspace. Trial spend accumulates for the
-- whole trial on orgs; paid-plan spend is kept per UTC calendar month. Budgets
-- themselves are configuration, not data, and are not stored here.

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS trial_chat_spend_micros bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS trial_embedding_spend_micros bigint NOT NULL DEFAULT 0;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS platform_ai_usage (
  org_id                 integer NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  period                 text    NOT NULL,
  chat_spend_micros      bigint  NOT NULL DEFAULT 0,
  embedding_spend_micros bigint  NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, period)
);
--> statement-breakpoint

-- Replaced by the spend columns above.
ALTER TABLE orgs DROP COLUMN IF EXISTS platform_key_trial_used;
