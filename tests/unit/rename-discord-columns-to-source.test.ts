import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Guardrail for GitHub issue #224: five ticket columns were named after
// Discord (discord_message_id, discord_thread_id, discord_channel_id,
// discord_author_id, discord_author_name) but have been used generically
// across every ingest platform (Slack, Telegram, Email, GitHub) since those
// channels were added. This PR renamed them to source_message_id,
// source_thread_id, source_channel_id, source_author_id, source_author_name.
//
// discord_guild_id and discord_deleted_at were deliberately NOT renamed —
// guilds are a genuinely Discord-only concept, and the deleted-at tracking
// has no equivalent on other platforms. This test also asserts those two
// stay put, so a future "helpful" rename doesn't sweep them in by mistake.
//
// Source-shape assertions only (file-content checks) — no live DB needed,
// matching this repo's convention (see tests/unit/webhook-idempotency-ordering.test.ts,
// tests/unit/auth-cookie-name-collision.test.ts).

const ROOT = process.cwd()

function read(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

const RENAMES: Array<[oldSnake: string, newSnake: string]> = [
  ['discord_message_id', 'source_message_id'],
  ['discord_thread_id', 'source_thread_id'],
  ['discord_channel_id', 'source_channel_id'],
  ['discord_author_id', 'source_author_id'],
  ['discord_author_name', 'source_author_name'],
]

const OLD_SNAKE_NAMES = RENAMES.map(([oldSnake]) => oldSnake)
const OLD_CAMEL_NAMES = [
  'discordMessageId',
  'discordThreadId',
  'discordChannelId',
  'discordAuthorId',
  'discordAuthorName',
]

// Extract just the tickets table's own pgTable(...) block from schema.ts, so
// the unrelated answerMessages table (which legitimately still has its own
// discordMessageId/discord_message_id column for the Discord reaction-
// feedback feature) never triggers a false failure.
function ticketsTableBlock(schemaSrc: string): string {
  const start = schemaSrc.indexOf('export const tickets = pgTable(')
  expect(start, 'could not find `export const tickets = pgTable(` in schema.ts').toBeGreaterThan(-1)
  const nextExportConst = schemaSrc.indexOf('export const ', start + 1)
  expect(nextExportConst, 'could not find the next `export const` after tickets in schema.ts').toBeGreaterThan(-1)
  return schemaSrc.slice(start, nextExportConst)
}

describe('migration: drizzle/0029_rename_ticket_source_columns.sql', () => {
  const migrationPath = 'drizzle/0029_rename_ticket_source_columns.sql'

  it('exists and is non-empty', () => {
    const sql = read(migrationPath)
    expect(sql.trim().length).toBeGreaterThan(0)
  })

  it('contains exactly 5 ALTER TABLE tickets RENAME COLUMN statements', () => {
    const sql = read(migrationPath)
    const matches = sql.match(/ALTER TABLE tickets RENAME COLUMN/g) ?? []
    expect(matches.length).toBe(5)
  })

  it.each(RENAMES)('renames %s to %s', (oldSnake, newSnake) => {
    const sql = read(migrationPath)
    const re = new RegExp(
      `ALTER TABLE tickets RENAME COLUMN ${oldSnake} TO ${newSnake};`
    )
    expect(sql).toMatch(re)
  })
})

describe('lib/db/schema.ts — tickets table', () => {
  const block = () => ticketsTableBlock(read('lib/db/schema.ts'))

  it('declares the 5 new Drizzle field names mapped to the correct new DB column strings', () => {
    const b = block()
    expect(b).toMatch(/sourceMessageId:\s*text\('source_message_id'\)/)
    expect(b).toMatch(/sourceChannelId:\s*text\('source_channel_id'\)/)
    expect(b).toMatch(/sourceThreadId:\s*text\('source_thread_id'\)/)
    expect(b).toMatch(/sourceAuthorId:\s*text\('source_author_id'\)/)
    expect(b).toMatch(/sourceAuthorName:\s*text\('source_author_name'\)/)
  })

  it('leaves discordGuildId/discord_guild_id unchanged (genuinely Discord-only)', () => {
    const b = block()
    expect(b).toMatch(/discordGuildId:\s*text\('discord_guild_id'\)/)
  })

  it('leaves discordDeletedAt/discord_deleted_at unchanged (no equivalent on other platforms)', () => {
    const b = block()
    expect(b).toMatch(/discordDeletedAt:\s*text\('discord_deleted_at'\)/)
  })

  it('does not contain any of the 5 old field/column names anywhere in the tickets table definition', () => {
    const b = block()
    for (const name of [...OLD_SNAKE_NAMES, ...OLD_CAMEL_NAMES]) {
      expect(b, `unexpected leftover "${name}" in tickets table block`).not.toContain(name)
    }
  })
})

describe('no leftover discord_* / discordX names in the renamed surface (excluding discord_guild_id / discord_deleted_at)', () => {
  const filesToCheck = [
    'types/index.ts',
    'lib/db/queries/tickets.ts',
    'lib/ingest/pipeline.ts',
    'lib/actions/tickets.ts',
  ]

  it.each(filesToCheck)('%s has no leftover old names', (relPath) => {
    const src = read(relPath)
    for (const name of [...OLD_SNAKE_NAMES, ...OLD_CAMEL_NAMES]) {
      expect(src, `unexpected leftover "${name}" in ${relPath}`).not.toContain(name)
    }
    // Sanity check the survivors are still present (proves the assertion
    // above isn't vacuously true because the whole discord_* family vanished).
    expect(src.includes('discord_guild_id') || src.includes('discordGuildId') ||
      src.includes('discord_deleted_at') || src.includes('discordDeletedAt') ||
      /source_(message|thread|channel|author)/.test(src)).toBe(true)
  })
})

describe('lib/db/queries/tickets.ts — renamed lookup function', () => {
  const src = () => read('lib/db/queries/tickets.ts')

  it('exports getTicketBySourceMessageId', () => {
    expect(src()).toMatch(/export\s+async\s+function\s+getTicketBySourceMessageId\s*\(/)
  })
})

describe('getTicketByDiscordMessageId no longer exists anywhere in lib/ or app/', () => {
  function walk(dir: string, out: string[] = []): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, out)
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        out.push(full)
      }
    }
    return out
  }

  it('is absent from every .ts/.tsx file under lib/ and app/', () => {
    const files = [
      ...walk(path.join(ROOT, 'lib')),
      ...walk(path.join(ROOT, 'app')),
    ]
    const offenders: string[] = []
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8')
      if (content.includes('getTicketByDiscordMessageId')) {
        offenders.push(path.relative(ROOT, file))
      }
    }
    expect(offenders, `found leftover getTicketByDiscordMessageId in: ${offenders.join(', ')}`).toEqual([])
  })
})
