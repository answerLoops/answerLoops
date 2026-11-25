-- Emailing a workspace's owners and admins when a visitor leaves their email in
-- the website chat. See lib/widget/lead-notifications.ts.
--
-- widget_leads.notified_at records when a lead was included in an email. It is
-- NULL for a lead that has not been emailed yet. Leads saved before this column
-- existed are marked as already notified by the column default below, so the
-- first sweep after this migration does not email a backlog.
--
-- orgs.widget_leads_emailed_at is the last time a workspace was emailed about
-- leads. It limits a workspace to one email per window, however many leads
-- arrive, and is claimed with one conditional UPDATE so two requests cannot
-- both send.
--
-- Both statements can be applied twice: the column is added only once, and the
-- default is dropped again straight away so new leads start as NULL.
ALTER TABLE widget_leads ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE widget_leads ALTER COLUMN notified_at DROP DEFAULT;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_leads_emailed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_widget_leads_pending ON widget_leads (org_id) WHERE notified_at IS NULL;
