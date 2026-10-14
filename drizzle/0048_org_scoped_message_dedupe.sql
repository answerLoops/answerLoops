-- Message de-duplication keys are scoped to the org that owns the row.
-- Platform-issued ids (Slack timestamps, email Message-IDs, forwarded
-- messages) are only unique within one workspace, so the single-column unique
-- constraints become (org_id, ...) composites.
--
-- Existing rows already satisfy the composite keys (a globally unique value is
-- also unique within each org), so no data changes are needed.

DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum = ANY (con.conkey)
    WHERE rel.relname = 'tickets'
      AND con.contype = 'u'
      AND array_length(con.conkey, 1) = 1
      AND a.attname = 'source_message_id'
  LOOP
    EXECUTE format('ALTER TABLE tickets DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
--> statement-breakpoint

DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum = ANY (con.conkey)
    WHERE rel.relname = 'email_messages'
      AND con.contype = 'u'
      AND array_length(con.conkey, 1) = 1
      AND a.attname = 'rfc_message_id'
  LOOP
    EXECUTE format('ALTER TABLE email_messages DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS tickets_org_source_message_unique ON tickets (org_id, source_message_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS email_messages_org_rfc_message_unique ON email_messages (org_id, rfc_message_id);
