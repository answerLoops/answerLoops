-- One enabled integration per external workspace / site / space.
--
-- Slack team ids, Discourse site URLs and Google Chat space names live in
-- integrations.team_id and are the only key an inbound event carries, so two
-- enabled rows with the same (platform, team_id) would make the lookup
-- ambiguous. The index is created only when the existing data already
-- satisfies it; otherwise the offending pairs are reported as a WARNING and
-- the index is skipped, so the migration never disables or deletes a
-- customer's connection on its own. The application resolves ties
-- deterministically (lowest id) in the meantime.

DO $$
DECLARE
  dup RECORD;
  dup_count INTEGER := 0;
BEGIN
  FOR dup IN
    SELECT platform, team_id, count(*) AS n, array_agg(id ORDER BY id) AS ids
    FROM integrations
    WHERE enabled = 1
      AND team_id IS NOT NULL
      AND platform IN ('slack', 'discourse', 'google_chat')
    GROUP BY platform, team_id
    HAVING count(*) > 1
  LOOP
    dup_count := dup_count + 1;
    RAISE WARNING 'integrations_platform_team_enabled_unique skipped: % integrations (ids %) share platform % and team_id %', dup.n, dup.ids, dup.platform, dup.team_id;
  END LOOP;

  IF dup_count = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS integrations_platform_team_enabled_unique
      ON integrations (platform, team_id)
      WHERE enabled = 1 AND team_id IS NOT NULL AND platform IN ('slack', 'discourse', 'google_chat');
  END IF;
END $$;
