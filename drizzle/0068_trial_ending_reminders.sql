-- Trial-ending reminder emails. A card-free trial has no Stripe event to hang a
-- "your trial is ending" notice on, so a sweep sends them and these two
-- columns record that it did. One per notice: the 3-days-left email and the
-- 1-day-left email each go out at most once per trial. A sweep claims a notice
-- by setting its column with a single conditional UPDATE, so two overlapping
-- sweeps cannot both send it, and releases the claim if the send fails so the
-- next sweep retries. NULL means not sent; existing rows are left NULL, which
-- is correct for trials that are still running.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_reminder_3d_sent_at TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_reminder_1d_sent_at TIMESTAMPTZ;
