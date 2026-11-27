import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { provisionUser } from '@/lib/auth/provision'
import { runMigrations } from '@/lib/db/migrate'
import { users, orgs, memberships, trialClaims, integrations, discordGuilds } from '@/lib/db/schema'

const state = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('@/lib/db/drizzle', () => state)

const url = process.env.TEST_ACTIVITY_DATABASE_URL

const schemaName = `auth_prov_${randomUUID().replaceAll('-', '')}`

describe.skipIf(!url)('Account provisioning & identity uniqueness on PostgreSQL', () => {
  let admin: postgres.Sql
  let client: postgres.Sql
  let db: ReturnType<typeof drizzle>

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin.unsafe(`CREATE SCHEMA ${schemaName}`)

    client = postgres(url!, {
      prepare: false,
      onnotice: () => {},
      connection: {
        search_path: `${schemaName},pg_catalog`,
        application_name: schemaName,
        lock_timeout: 5_000,
        statement_timeout: 8_000,
      },
    })

    db = drizzle(client)
    state.getDb.mockReturnValue(db)

    const createTable = async (table: any, name: string) => {
      const columns = Object.values(getTableColumns(table)).map((c: any) =>
        c.name === 'id' ? 'id serial primary key' : `"${c.name}" ${c.getSQLType()}`
      )
      await client.unsafe(`CREATE TABLE ${name} (${columns.join(', ')})`)
    }

    await createTable(users, 'users')
    await client.unsafe(`ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email)`)
    await createTable(orgs, 'orgs')
    await createTable(memberships, 'memberships')
    await createTable(trialClaims, 'trial_claims')

    // Apply migration 0092 (unique index on provider/provider_account_id).
    const migrationSql = fs.readFileSync('drizzle/0092_users_provider_account_unique.sql', 'utf8')
    for (const stmt of migrationSql.split('--> statement-breakpoint')) {
      if (stmt.trim()) {
        await client.unsafe(stmt)
      }
    }
  })

  afterAll(async () => {
    try {
      await admin.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`)
      await client?.end()
      await admin?.end()
    } catch {
      // ignore cleanup errors
    }
  })

  beforeEach(async () => {
    await client.unsafe(`TRUNCATE trial_claims, memberships, orgs, users RESTART IDENTITY CASCADE`)
  })

  it('provisions a new Google user and creates their organization and membership', async () => {
    const result = await provisionUser(
      'googleuser@example.com',
      'Google User',
      'https://avatar.google.com/u',
      'google',
      'google-sub-100',
    )

    expect(result.userId).toBe(1)
    expect(result.orgId).toBe(1)

    const [user] = await client<
      { id: number; email: string; provider: string; provider_account_id: string }[]
    >`SELECT id, email, provider, provider_account_id FROM users WHERE id = ${result.userId}`
    expect(user).toBeDefined()
    expect(user.email).toBe('googleuser@example.com')
    expect(user.provider).toBe('google')
    expect(user.provider_account_id).toBe('google-sub-100')

    const [membership] = await client<
      { user_id: number; org_id: number; role: string }[]
    >`SELECT user_id, org_id, role FROM memberships WHERE user_id = ${result.userId}`
    expect(membership).toBeDefined()
    expect(membership.role).toBe('owner')
  })

  it('safely handles concurrent provisioning of the exact same GitHub identity with same email', async () => {
    const results = await Promise.all([
      provisionUser('octocat@github.com', 'Mona', null, 'github', 'gh-12345'),
      provisionUser('octocat@github.com', 'Mona', null, 'github', 'gh-12345'),
    ])

    // Both successful requests resolve the same user ID and organization ID
    expect(results[0].userId).toBe(results[1].userId)
    expect(results[0].orgId).toBe(results[1].orgId)

    // Exactly one user for the provider-scoped identity
    const count = await client<{ count: string }[]>`
      SELECT count(*) as count FROM users WHERE provider = 'github' AND provider_account_id = 'gh-12345'
    `
    expect(Number(count[0].count)).toBe(1)

    // Exactly one newly provisioned workspace
    const orgRows = await client<{ id: number }[]>`SELECT id FROM orgs`
    expect(orgRows).toHaveLength(1)
    expect(orgRows[0].id).toBe(results[0].orgId)

    // Exactly one owner membership
    const membershipRows = await client<{ user_id: number; org_id: number; role: string }[]>`
      SELECT user_id, org_id, role FROM memberships WHERE user_id = ${results[0].userId}
    `
    expect(membershipRows).toHaveLength(1)
    expect(membershipRows[0].role).toBe('owner')
    expect(membershipRows[0].org_id).toBe(results[0].orgId)

    // No orphaned organizations
    const allOrgs = await client<{ count: string }[]>`SELECT count(*) as count FROM orgs`
    const allUsers = await client<{ count: string }[]>`SELECT count(*) as count FROM users`
    expect(Number(allOrgs[0].count)).toBe(Number(allUsers[0].count))
  })

  it('safely handles concurrent provisioning of the same GitHub identity with DIFFERENT verified emails', async () => {
    // Both requests have identical providerAccountId 'gh-concurrent', but different emails.
    // Database unique index on (provider, provider_account_id) ensures only one user row is created.
    const results = await Promise.all([
      provisionUser('first@example.com', 'Dev One', null, 'github', 'gh-concurrent'),
      provisionUser('second@example.com', 'Dev Two', null, 'github', 'gh-concurrent'),
    ])

    // Both successful requests resolve the same user ID and organization ID
    expect(results[0].userId).toBe(results[1].userId)
    expect(results[0].orgId).toBe(results[1].orgId)

    // Exactly one user for the provider-scoped identity
    const rows = await client<
      { id: number; provider: string; provider_account_id: string; email: string }[]
    >`SELECT id, provider, provider_account_id, email FROM users WHERE provider = 'github' AND provider_account_id = 'gh-concurrent'`

    expect(rows).toHaveLength(1)
    expect(rows[0].provider_account_id).toBe('gh-concurrent')

    // Exactly one workspace and one owner membership
    const orgRows = await client<{ id: number }[]>`SELECT id FROM orgs`
    expect(orgRows).toHaveLength(1)
    expect(orgRows[0].id).toBe(results[0].orgId)

    const membershipRows = await client<{ user_id: number; org_id: number; role: string }[]>`
      SELECT user_id, org_id, role FROM memberships WHERE user_id = ${results[0].userId}
    `
    expect(membershipRows).toHaveLength(1)
    expect(membershipRows[0].role).toBe('owner')

    // No orphaned organizations
    const allOrgs = await client<{ count: string }[]>`SELECT count(*) as count FROM orgs`
    const allUsers = await client<{ count: string }[]>`SELECT count(*) as count FROM users`
    expect(Number(allOrgs[0].count)).toBe(Number(allUsers[0].count))
  })

  it('rejects cross-provider email collisions without mutating existing user or workspace', async () => {
    // 1. Google user exists.
    const googleRes = await provisionUser('shared@company.com', 'Alice Google', null, 'google', 'goog-alice')
    expect(googleRes.userId).toBe(1)

    // Snapshot counts before failed attempt.
    const [userCountBefore] = await client<{ c: string }[]>`SELECT count(*) as c FROM users`
    const [orgCountBefore] = await client<{ c: string }[]>`SELECT count(*) as c FROM orgs`
    const [membershipCountBefore] = await client<{ c: string }[]>`SELECT count(*) as c FROM memberships`

    // 2. Attempt to sign in with GitHub using the same email.
    await expect(
      provisionUser('shared@company.com', 'Alice GitHub', null, 'github', 'gh-alice'),
    ).rejects.toThrow('Email collision: account was created with google')

    // Snapshot counts after failed attempt.
    const [userCountAfter] = await client<{ c: string }[]>`SELECT count(*) as c FROM users`
    const [orgCountAfter] = await client<{ c: string }[]>`SELECT count(*) as c FROM orgs`
    const [membershipCountAfter] = await client<{ c: string }[]>`SELECT count(*) as c FROM memberships`

    expect(userCountAfter.c).toBe(userCountBefore.c)
    expect(orgCountAfter.c).toBe(orgCountBefore.c)
    expect(membershipCountAfter.c).toBe(membershipCountBefore.c)

    // Ensure the Google user's record was not overwritten or reassigned.
    const [googleUser] = await client<
      { provider: string; provider_account_id: string }[]
    >`SELECT provider, provider_account_id FROM users WHERE id = 1`
    expect(googleUser.provider).toBe('google')
    expect(googleUser.provider_account_id).toBe('goog-alice')
  })

  it('safely performs atomic conditional update on legacy Google accounts', async () => {
    // Legacy Google user with null provider and null providerAccountId.
    await client.unsafe(`
      INSERT INTO users (id, email, name, provider, provider_account_id)
      VALUES (10, 'legacy@domain.com', 'Legacy User', NULL, NULL);
      INSERT INTO orgs (id, name, slug) VALUES (10, 'Legacy Org', 'org-10');
      INSERT INTO memberships (user_id, org_id, role) VALUES (10, 10, 'owner');
    `)

    // Sign in with Google: safely populates provider and providerAccountId.
    const result = await provisionUser('legacy@domain.com', 'Legacy User Updated', null, 'google', 'goog-legacy-sub')
    expect(result.userId).toBe(10)
    expect(result.orgId).toBe(10)

    const [updatedUser] = await client<
      { provider: string; provider_account_id: string }[]
    >`SELECT provider, provider_account_id FROM users WHERE id = 10`
    expect(updatedUser.provider).toBe('google')
    expect(updatedUser.provider_account_id).toBe('goog-legacy-sub')

    // Subsequent sign-in with Google and wrong account ID is rejected.
    await expect(
      provisionUser('legacy@domain.com', 'Other User', null, 'google', 'goog-other-sub'),
    ).rejects.toThrow('Account ID mismatch for existing user email')
  })

  it('preserves legacy user where provider is null but providerAccountId is already populated', async () => {
    await client.unsafe(`
      INSERT INTO users (id, email, name, provider, provider_account_id)
      VALUES (20, 'partial@domain.com', 'Partial Legacy', NULL, 'sub-20');
      INSERT INTO orgs (id, name, slug) VALUES (20, 'Partial Org', 'org-20');
      INSERT INTO memberships (user_id, org_id, role) VALUES (20, 20, 'owner');
    `)

    // Matches the existing providerAccountId 'sub-20': succeeds and assigns provider = 'google'.
    const result = await provisionUser('partial@domain.com', 'Partial User', null, 'google', 'sub-20')
    expect(result.userId).toBe(20)

    const [row] = await client<{ provider: string }[]>`SELECT provider FROM users WHERE id = 20`
    expect(row.provider).toBe('google')

    // Different account ID on same email is rejected.
    await expect(
      provisionUser('partial@domain.com', 'Wrong', null, 'google', 'different-sub'),
    ).rejects.toThrow('Account ID mismatch for existing user email')
  })

  it('updates a returning GitHub user email when uncontested and rejects when contested', async () => {
    // 1. Initial provisioning.
    const initial = await provisionUser('bob.initial@github.com', 'Bob', null, 'github', 'gh-bob')
    expect(initial.userId).toBe(1)

    // 2. Bob changes email on GitHub to an uncontested email.
    const returning = await provisionUser('bob.new@github.com', 'Bob', null, 'github', 'gh-bob')
    expect(returning.userId).toBe(1)

    const [bobRow] = await client<{ email: string }[]>`SELECT email FROM users WHERE id = 1`
    expect(bobRow.email).toBe('bob.new@github.com')

    // 3. Another user creates an account.
    await provisionUser('taken@company.com', 'Charlie', null, 'google', 'goog-charlie')

    // 4. Bob changes email on GitHub to 'taken@company.com'.
    await expect(
      provisionUser('taken@company.com', 'Bob', null, 'github', 'gh-bob'),
    ).rejects.toThrow('Email belongs to another user account')

    // Bob's email remains the uncontested one.
    const [bobAfter] = await client<{ email: string }[]>`SELECT email FROM users WHERE id = 1`
    expect(bobAfter.email).toBe('bob.new@github.com')
  })

  it('correctly matches and preserves legacy mixed-case email on PostgreSQL', async () => {
    // Legacy user stored with uppercase/mixed-case email in PostgreSQL
    await client.unsafe(`
      INSERT INTO users (id, email, name, provider, provider_account_id)
      VALUES (30, 'LegacyMixedCase@Example.COM', 'Mixed Case User', 'google', 'goog-mixed-sub');
      INSERT INTO orgs (id, name, slug) VALUES (30, 'Mixed Org', 'org-30');
      INSERT INTO memberships (user_id, org_id, role) VALUES (30, 30, 'owner');
    `)

    // Sign in with normalized lowercase email
    const result = await provisionUser('legacymixedcase@example.com', 'Mixed User', null, 'google', 'goog-mixed-sub')
    expect(result.userId).toBe(30)
    expect(result.orgId).toBe(30)

    // Cross-provider collision against mixed-case email is rejected
    await expect(
      provisionUser('legacymixedcase@example.com', 'GitHub User', null, 'github', 'gh-user-456'),
    ).rejects.toThrow('Email collision: account was created with google')
  })

  it('safely handles concurrent insert collisions on email uniqueness across different providers', async () => {
    // Two simultaneous sign-in requests with the same email under different providers.
    const email = 'concurrent.collision@example.com'
    const results = await Promise.allSettled([
      provisionUser(email, 'Google User', null, 'google', 'goog-concurrent-1'),
      provisionUser(email, 'GitHub User', null, 'github', 'gh-concurrent-2'),
    ])

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<{ userId: number; orgId: number }> => r.status === 'fulfilled',
    )
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')

    // Exactly one provider wins, and the other is safely rejected with an email collision.
    expect(fulfilled.length).toBe(1)
    expect(rejected.length).toBe(1)
    expect(rejected[0].reason.message).toMatch(/^Email collision: account was created with /)

    // Exactly 1 user row exists for this email in PostgreSQL.
    const allUsers = await client<{ id: number; email: string }[]>`SELECT id, email FROM users WHERE email = ${email}`
    expect(allUsers.length).toBe(1)
  })

  it('confirms 0092 migration is applied by the normal migration runner (runMigrations)', async () => {
    const migrationSchema = `mig_test_${randomUUID().replaceAll('-', '')}`
    await admin.unsafe(`CREATE SCHEMA ${migrationSchema}`)

    const migClient = postgres(url!, {
      prepare: false,
      onnotice: () => {},
      connection: {
        search_path: `${migrationSchema},pg_catalog`,
        application_name: migrationSchema,
      },
    })
    const migDb = drizzle(migClient)

    // Pre-create users table in migration schema so 0092 can apply
    const createTableInMig = async (table: any, name: string) => {
      const columns = Object.values(getTableColumns(table)).map((c: any) =>
        c.name === 'id' ? 'id serial primary key' : `"${c.name}" ${c.getSQLType()}`
      )
      await migClient.unsafe(`CREATE TABLE ${name} (${columns.join(', ')})`)
    }
    await createTableInMig(users, 'users')
    await migClient.unsafe(`ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email)`)
    await createTableInMig(orgs, 'orgs')
    await createTableInMig(memberships, 'memberships')
    await createTableInMig(integrations, 'integrations')
    await createTableInMig(discordGuilds, 'discord_guilds')
    await migClient.unsafe(`
      CREATE TABLE IF NOT EXISTS invitations (id serial primary key, org_id integer, accepted_at timestamptz);
      CREATE TABLE IF NOT EXISTS tickets (id serial primary key, org_id integer);
      CREATE TABLE IF NOT EXISTS notifications (id serial primary key, org_id integer);
      CREATE TABLE IF NOT EXISTS kb_sync_jobs (id serial primary key, status text);
    `)

    // Pre-seed __custom_migrations with every other migration so runMigrations executes only 0092
    await migClient.unsafe(`
      CREATE TABLE IF NOT EXISTS __custom_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `)
    const migrationsDir = path.resolve(process.cwd(), 'drizzle')
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    for (const f of files) {
      if (f !== '0092_users_provider_account_unique.sql') {
        await migClient.unsafe(`INSERT INTO __custom_migrations (filename) VALUES ('${f}') ON CONFLICT DO NOTHING;`)
      }
    }

    // Run the normal application migration runner with migDb
    state.getDb.mockReturnValue(migDb)
    await runMigrations()

    // Verify 0092 is recorded in __custom_migrations
    const [rec] = await migClient<{ filename: string }[]>`
      SELECT filename FROM __custom_migrations WHERE filename = '0092_users_provider_account_unique.sql'
    `
    expect(rec).toBeDefined()
    expect(rec.filename).toBe('0092_users_provider_account_unique.sql')

    // Verify the unique index actually exists in PostgreSQL catalog
    const [idx] = await migClient<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = ${migrationSchema} AND tablename = 'users' AND indexname = 'users_provider_provider_account_id_unique'
    `
    expect(idx).toBeDefined()
    expect(idx.indexname).toBe('users_provider_provider_account_id_unique')

    // Restore state.getDb
    state.getDb.mockReturnValue(db)
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${migrationSchema} CASCADE`)
    await migClient.end()
  })
})
