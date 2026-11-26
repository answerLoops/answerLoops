-- A daily limit on website widget answers that the workspace owner chooses.
-- See lib/widget/usage-limits.ts.
--
-- NULL means the owner set no limit of their own, so the instance's ceiling
-- applies (3,000 answers a day unless WIDGET_LIMIT_PER_WORKSPACE_PER_DAY says
-- otherwise), which is what every workspace had before this column existed.
-- Adding the column therefore changes no live widget. The value is validated
-- where it is written (normalizeDailyLimit) and clamped to the ceiling where it
-- is read (effectiveDailyLimit), so the ceiling can change without a migration.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_daily_answer_limit INTEGER;
