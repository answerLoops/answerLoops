import { sql } from 'drizzle-orm'
import { getDb } from './drizzle'
import fs from 'node:fs'
import path from 'node:path'

// Postgres error codes that mean "schema object already exists".
// Safe to skip — the DB is already in the desired state.
const ALREADY_EXISTS = new Set([
  '42P07', // relation already exists (CREATE TABLE)
  '42701', // column already exists (ALTER TABLE ADD COLUMN)
  '42710', // duplicate object (constraint/index name)
  '42P16', // index already exists
  '42712', // duplicate rule
])

// Drizzle wraps postgres errors: the outer Error has no .code; the postgres
// code lives on err.cause (or err.cause.cause, etc.). Walk the chain.
function pgErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const e = err as Record<string, unknown>
  if (typeof e.code === 'string') return e.code
  return pgErrorCode(e.cause)
}

// Drizzle's journal-based migrate() only applies migrations registered in
// drizzle/meta/_journal.json. Our hand-written SQL files (0002+) were never
// added to the journal so migrate() silently skips them.
//
// This custom runner reads every *.sql file in ./drizzle/ (sorted by name),
// splits on Drizzle's "--> statement-breakpoint" markers, executes each
// statement individually, and skips "already exists" errors so the runner
// is idempotent even when transitioning from the old journal-based runner
// (which applied 0000 and 0001 but left no __custom_migrations record).
export async function runMigrations() {
  const db = getDb()

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS __custom_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  const migrationsDir = path.resolve(process.cwd(), 'drizzle')
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const applied = await db.execute(
    sql`SELECT filename FROM __custom_migrations`
  ) as unknown as { filename: string }[]
  const appliedSet = new Set(applied.map((r) => r.filename))

  for (const file of files) {
    if (appliedSet.has(file)) continue

    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    console.log(`[migrate] applying ${file}`)

    // Split on Drizzle's statement-breakpoint markers and execute each statement
    // individually. This lets us skip "already exists" errors per-statement
    // rather than aborting the whole migration.
    const statements = content
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)

    for (const stmt of statements) {
      try {
        await db.execute(sql.raw(stmt))
      } catch (err) {
        const code = pgErrorCode(err)
        if (code && ALREADY_EXISTS.has(code)) {
          // Schema already in desired state — skip silently
          continue
        }
        throw new Error(`[migrate] ${file} failed:\n${String(err)}`)
      }
    }

    await db.execute(
      sql`INSERT INTO __custom_migrations (filename) VALUES (${file})`
    )
    console.log(`[migrate] ${file} done`)
  }

  // Idempotent trigger: fires pg_notify('config_changed') whenever the
  // integrations table is written. The bot LISTENs on this channel and
  // hot-swaps its config without polling.
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION notify_config_changed()
    RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify('config_changed', '{}');
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_config_changed ON integrations;
    CREATE TRIGGER trg_config_changed
      AFTER INSERT OR UPDATE OR DELETE ON integrations
      FOR EACH ROW EXECUTE FUNCTION notify_config_changed();

    -- Per-guild channel picks (Settings → Discord, OAuth-connected servers)
    -- live in discord_guilds, not integrations — without this trigger, saving
    -- a channel selection there never notified the running bot, so the
    -- change only took effect after a manual restart. See discord-bot.mdx's
    -- Config hot-reload section, which claimed this already worked.
    DROP TRIGGER IF EXISTS trg_config_changed_discord_guilds ON discord_guilds;
    CREATE TRIGGER trg_config_changed_discord_guilds
      AFTER INSERT OR UPDATE OR DELETE ON discord_guilds
      FOR EACH ROW EXECUTE FUNCTION notify_config_changed();
  `)

  // Idempotent trigger: fires pg_notify('member_joined', org_id) on every new
  // membership INSERT. The SSE endpoint /api/events/stream LISTENs and pushes
  // the event to the owner's settings page so the team list updates in real time.
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION notify_member_joined()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_notify('member_joined', NEW.org_id::text);
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_member_joined ON memberships;
    CREATE TRIGGER trg_member_joined
      AFTER INSERT ON memberships
      FOR EACH ROW EXECUTE FUNCTION notify_member_joined();
  `)

  // Idempotent trigger: fires the same member_joined notification when an
  // invitation is accepted without inserting a new membership row — the
  // case where the accepting user is already a member of the invited org
  // (a re-clicked link, testing the flow as the org's own owner). That path
  // still needs to consume the invitation (see acceptInviteAction), and
  // without this trigger the Settings page's Pending Invites list would
  // only ever clear on the next full page load instead of live, unlike
  // every other invite-acceptance path.
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION notify_invite_accepted()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL THEN
        PERFORM pg_notify('member_joined', NEW.org_id::text);
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_invite_accepted ON invitations;
    CREATE TRIGGER trg_invite_accepted
      AFTER UPDATE ON invitations
      FOR EACH ROW EXECUTE FUNCTION notify_invite_accepted();
  `)

  // Idempotent trigger: fires pg_notify('data_changed', org_id) whenever a
  // ticket or notification row changes. The dashboard SSE stream
  // (/api/events/stream) LISTENs and pushes a single refresh to open
  // dashboard tabs for that org, replacing a fixed 5-second client poll that
  // re-ran every dashboard query whether or not anything had changed. Payload
  // is the org_id so the stream only wakes the right tenant. A single ingest
  // touches tickets and notifications across several separate transactions, so
  // one message produces several data_changed notifications — Postgres only
  // de-dups identical (channel, payload) pairs within one transaction, not
  // across them. The dashboard client debounces the resulting refresh; do not
  // rely on server-side collapsing here.
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION notify_data_changed()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_notify('data_changed', COALESCE(NEW.org_id, OLD.org_id)::text);
      RETURN COALESCE(NEW, OLD);
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_data_changed_tickets ON tickets;
    CREATE TRIGGER trg_data_changed_tickets
      AFTER INSERT OR UPDATE OR DELETE ON tickets
      FOR EACH ROW EXECUTE FUNCTION notify_data_changed();

    -- INSERT OR DELETE only: marking notifications read is a bulk UPDATE
    -- driven by a user action already on the page, so refreshing off it adds
    -- load with nothing new to show.
    DROP TRIGGER IF EXISTS trg_data_changed_notifications ON notifications;
    CREATE TRIGGER trg_data_changed_notifications
      AFTER INSERT OR DELETE ON notifications
      FOR EACH ROW EXECUTE FUNCTION notify_data_changed();
  `)

  // Idempotent trigger: fires pg_notify('kb_sync_job_queued', id) whenever a
  // kb_sync_jobs row becomes queued — a fresh enqueue from "Sync now" or the
  // GitHub push webhook, or the bot's stuck-job sweep requeuing a crashed run.
  // The bot LISTENs on this channel (same connection as config_changed/
  // member_joined/data_changed) and claims the job immediately, replacing an
  // unconditional 15-second poll that ran forever regardless of whether any
  // job existed — on Neon-style serverless Postgres that kept the database
  // compute from ever autosuspending. A coarse periodic sweep remains as a
  // safety net for a missed NOTIFY or a job stuck in `running`.
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION notify_kb_sync_job_queued()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_notify('kb_sync_job_queued', NEW.id::text);
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_kb_sync_job_queued_insert ON kb_sync_jobs;
    CREATE TRIGGER trg_kb_sync_job_queued_insert
      AFTER INSERT ON kb_sync_jobs
      FOR EACH ROW WHEN (NEW.status = 'queued')
      EXECUTE FUNCTION notify_kb_sync_job_queued();

    DROP TRIGGER IF EXISTS trg_kb_sync_job_queued_update ON kb_sync_jobs;
    CREATE TRIGGER trg_kb_sync_job_queued_update
      AFTER UPDATE ON kb_sync_jobs
      FOR EACH ROW WHEN (NEW.status = 'queued' AND OLD.status IS DISTINCT FROM 'queued')
      EXECUTE FUNCTION notify_kb_sync_job_queued();
  `)
}
