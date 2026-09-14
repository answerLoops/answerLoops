import fs from 'fs'
import path from 'path'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { getDb } from '../lib/db/drizzle'
import { runMigrations } from '../lib/db/migrate'
import { memberships, githubRepos } from '../lib/db/schema'
import { DEFAULT_ORG_ID } from '../lib/db/schema'
import { ensureWidgetToken } from '../lib/db/queries/widgets'

export const WIDGET_TOKEN_FILE = path.join(__dirname, '.tmp', 'widget-token.json')

const SESSION_COOKIE = 'authjs.session-token'
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60 // 7 days

// Postgres error code for "database already exists" — thrown by CREATE DATABASE
// when another test run (or a previous attempt) already created it.
const DATABASE_ALREADY_EXISTS = '42P04'

// Our default fallback DB (community_test) is never provisioned by docker-compose,
// which only creates `community`. Self-heal by connecting to the `community` admin
// database and creating `community_test` if it's missing, so the default fallback
// actually works out of the box instead of requiring a developer to create it by hand.
// Skip this when TEST_DATABASE_URL was explicitly set — the developer owns that DB.
async function ensureTestDatabaseExists() {
  if (process.env.TEST_DATABASE_URL) return

  const url = new URL(process.env.DATABASE_URL!)
  const targetDatabase = url.pathname.replace(/^\//, '')

  const adminUrl = new URL(url.toString())
  adminUrl.pathname = '/community'

  const adminClient = postgres(adminUrl.toString(), { max: 1 })
  try {
    // Quote the identifier per Postgres rules (double any embedded double-quotes)
    // rather than parameterizing — CREATE DATABASE doesn't accept bound params.
    const quotedName = `"${targetDatabase.replace(/"/g, '""')}"`
    await adminClient.unsafe(`CREATE DATABASE ${quotedName}`)
  } catch (err) {
    const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code
    if (code !== DATABASE_ALREADY_EXISTS) {
      throw err
    }
  } finally {
    await adminClient.end()
  }
}

export default async function globalSetup() {
  const stateDir = path.join(__dirname, '.tmp')
  fs.mkdirSync(stateDir, { recursive: true })

  // Make sure the target test database exists before connecting via getDb().
  await ensureTestDatabaseExists()

  // Apply migrations and wipe test data to a clean baseline.
  await runMigrations()
  const db = getDb()

  // Truncate all tables (order matters for FK constraints)
  await db.execute(sql`
    TRUNCATE integrations, github_repos, ticket_feedback, answer_messages,
      ticket_links, ticket_embeddings, kb_articles, kb_sources, faq_snapshots,
      notifications, ticket_events, ticket_replies, tickets,
      ai_assessments, ai_configs, push_subscriptions, sla_configs,
      invitations, memberships, users, orgs
    RESTART IDENTITY CASCADE
  `)

  // Seed default org
  await db.execute(sql`
    INSERT INTO orgs (id, name, slug, onboarded_at)
    VALUES (${DEFAULT_ORG_ID}, 'Test Workspace', 'test-workspace', NOW())
    ON CONFLICT (id) DO UPDATE SET onboarded_at = NOW()
  `)

  // Seed a configured GitHub repo so the AI agent runs during ingest.
  await db
    .insert(githubRepos)
    .values({ installationId: 1, owner: 'acme', repo: 'demo', isPrivate: 0, orgId: DEFAULT_ORG_ID })
    .onConflictDoNothing()

  // Seed a test staff user + membership
  await db.execute(sql`
    INSERT INTO users (id, email, name, provider)
    VALUES (1, 'staff@example.com', 'Test Staff', 'test')
    ON CONFLICT (email) DO NOTHING
  `)

  await db
    .insert(memberships)
    .values({ userId: 1, orgId: DEFAULT_ORG_ID, role: 'owner' })
    .onConflictDoNothing()

  // Seed a widget token for the default org (used by widget.spec.ts)
  const widgetInfo = await ensureWidgetToken(DEFAULT_ORG_ID)
  fs.writeFileSync(WIDGET_TOKEN_FILE, JSON.stringify({ token: widgetInfo.token }))

  // Seed a Discord integration for the default org. auto_deflect_enabled is
  // explicit rather than left at its default-off: several specs (analytics,
  // smoke) assert on high-confidence answers actually auto-posting, and the
  // safety default of holding every answer as a draft would otherwise zero
  // out deflection stats for the whole suite.
  const botSecret = process.env.BOT_SECRET ?? 'test-bot-secret'
  await db.execute(sql`
    INSERT INTO integrations (org_id, platform, bot_secret, channel_ids, enabled, auto_deflect_enabled)
    VALUES (${DEFAULT_ORG_ID}, 'discord', ${botSecret}, '[]', 1, 1)
    ON CONFLICT DO NOTHING
  `)

  const authSecret = process.env.AUTH_SECRET!
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS

  const { encode } = await import('next-auth/jwt')
  const token = await encode({
    token: {
      sub: '1',
      name: 'Test Staff',
      email: 'staff@example.com',
      userId: '1',
      orgId: DEFAULT_ORG_ID,
      iat: Math.floor(Date.now() / 1000),
      exp,
    },
    secret: authSecret,
    salt: SESSION_COOKIE,
    maxAge: MAX_AGE_SECONDS,
  })

  fs.writeFileSync(
    path.join(stateDir, 'state.json'),
    JSON.stringify({
      cookies: [
        {
          name: SESSION_COOKIE,
          value: token,
          domain: 'localhost',
          path: '/',
          expires: exp,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    })
  )
}
