-- A workspace on Pro or above can have the website chat offer two or three
-- suggested next questions after some answers. This column is the owner's
-- switch for that.
--
-- NULL (the default) and true mean on; only an explicit false turns it off, so
-- adding the column cannot change any live widget until its owner chooses.
-- Whether a workspace's plan includes the feature is decided where the chat
-- reads this value (lib/widget/follow-ups.ts), not here.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_follow_ups_enabled BOOLEAN;
