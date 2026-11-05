-- A stable public identifier for the chat widget, so the embed snippet no longer
-- has to carry the rotating widget token. The loader script resolves the slug to
-- the current token when a page loads, which lets an owner rotate the token
-- without anyone re-pasting the snippet.
--
-- Nullable: existing workspaces keep embedding with their token until an owner
-- chooses a slug. The unique index ignores the NULLs, so any number of
-- workspaces can be without one.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_slug TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS orgs_widget_slug_key ON orgs (widget_slug) WHERE widget_slug IS NOT NULL;
