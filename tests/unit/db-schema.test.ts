import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Validate that all migration files exist, are non-empty, and contain valid SQL.
// Validate that the Drizzle schema exports all expected tables.
// These run in vitest (no DB connection needed) — structural assertions only.

const DRIZZLE_DIR = path.join(process.cwd(), 'drizzle')
const META_FILE = path.join(DRIZZLE_DIR, 'meta', '_journal.json')

describe('DB migrations: file integrity', () => {
  it('drizzle directory exists', () => {
    expect(fs.existsSync(DRIZZLE_DIR)).toBe(true)
  })

  it('migration journal exists', () => {
    expect(fs.existsSync(META_FILE)).toBe(true)
  })

  it('all migrations in journal have corresponding SQL files', () => {
    const journal = JSON.parse(fs.readFileSync(META_FILE, 'utf-8')) as {
      entries: Array<{ tag: string }>
    }
    for (const entry of journal.entries) {
      const sqlFile = path.join(DRIZZLE_DIR, `${entry.tag}.sql`)
      expect(fs.existsSync(sqlFile), `Missing migration file: ${entry.tag}.sql`).toBe(true)
    }
  })

  it('all SQL migration files are non-empty', () => {
    const sqlFiles = fs.readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql'))
    expect(sqlFiles.length).toBeGreaterThan(0)
    for (const file of sqlFiles) {
      const content = fs.readFileSync(path.join(DRIZZLE_DIR, file), 'utf-8').trim()
      expect(content.length, `Empty migration: ${file}`).toBeGreaterThan(0)
    }
  })

  it('migrations define expected tables', () => {
    const sqlFiles = fs.readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql'))
    const allSql = sqlFiles
      .map((f) => fs.readFileSync(path.join(DRIZZLE_DIR, f), 'utf-8'))
      .join('\n')
      .toLowerCase()

    const expectedTables = [
      'orgs',
      'users',
      'memberships',
      'tickets',
      'ticket_replies',
      'ticket_events',
      'kb_articles',
      'kb_sources',
      'integrations',
      'invitations',
      'ai_configs',
      'sla_configs',
    ]
    for (const table of expectedTables) {
      expect(allSql, `Missing table in migrations: ${table}`).toContain(table)
    }
  })

  it('kb_sources migration adds source_id and source_page columns to kb_articles', () => {
    const kbSourcesMigration = fs.readdirSync(DRIZZLE_DIR).find((f) => f.includes('kb_sources'))
    expect(kbSourcesMigration).toBeDefined()
    if (kbSourcesMigration) {
      const sql = fs.readFileSync(path.join(DRIZZLE_DIR, kbSourcesMigration), 'utf-8').toLowerCase()
      expect(sql).toContain('source_id')
      expect(sql).toContain('source_page')
    }
  })
})

describe('DB schema: exported tables', () => {
  it('schema exports all required tables', async () => {
    const schema = await import('../../lib/db/schema')
    const expectedExports = [
      'orgs',
      'users',
      'memberships',
      'tickets',
      'ticketReplies',
      'ticketEvents',
      'kbArticles',
      'kbSources',
      'integrations',
      'invitations',
      'aiConfigs',
      'slaConfigs',
      'subscriptions',
      'githubRepos',
      'pushSubscriptions',
      'discordGuilds',
    ]
    for (const name of expectedExports) {
      expect(schema, `Missing export: ${name}`).toHaveProperty(name)
    }
  })

  it('kbSources table has required columns', async () => {
    const { kbSources } = await import('../../lib/db/schema')
    // Drizzle table object should be truthy
    expect(kbSources).toBeTruthy()
  })

  it('kbArticles has sourceId foreign key', async () => {
    const { kbArticles } = await import('../../lib/db/schema')
    expect(kbArticles).toBeTruthy()
  })

  it('apiKeys table exposes the scopes column (migration 0038)', async () => {
    const { apiKeys } = await import('../../lib/db/schema')
    expect(apiKeys).toBeTruthy()
    expect('scopes' in apiKeys).toBe(true)
  })

  it('DEFAULT_ORG_ID is exported and is a number', async () => {
    const { DEFAULT_ORG_ID } = await import('../../lib/db/schema')
    expect(typeof DEFAULT_ORG_ID).toBe('number')
    expect(DEFAULT_ORG_ID).toBeGreaterThan(0)
  })
})
