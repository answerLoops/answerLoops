import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Infra tests for new email/Slack/Telegram channel API routes.
// Source-file assertions only — Next.js route modules cannot be imported in vitest.

const ROOT = process.cwd()

function readRoute(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `Route not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('Email ingest route', () => {
  it('file exists and exports POST', () => {
    const src = readRoute('app/api/email/ingest/route.ts')
    expect(src).toContain('export async function POST')
  })

  it('validates integration via getIntegrationByBotSecret before processing', () => {
    const src = readRoute('app/api/email/ingest/route.ts')
    expect(src).toContain('getIntegrationByBotSecret')
  })

  it('pipes through ingest pipeline', () => {
    const src = readRoute('app/api/email/ingest/route.ts')
    expect(src).toContain('processCommunityMessage')
  })
})

describe('Slack OAuth routes', () => {
  it('install route exists and exports GET', () => {
    const src = readRoute('app/api/slack/install/route.ts')
    expect(src).toContain('export async function GET')
  })

  it('callback route exists and exports GET', () => {
    const src = readRoute('app/api/slack/callback/route.ts')
    expect(src).toContain('export async function GET')
  })

  it('channels route exists and exports GET', () => {
    const src = readRoute('app/api/slack/channels/route.ts')
    expect(src).toContain('export async function GET')
  })

  it('install route references SLACK_CLIENT_ID env var', () => {
    const src = readRoute('app/api/slack/install/route.ts')
    expect(src).toContain('SLACK_CLIENT_ID')
  })

  it('callback route exchanges code for access_token', () => {
    const src = readRoute('app/api/slack/callback/route.ts')
    expect(src).toContain('access_token')
  })

  it('callback route persists integration via upsertIntegration', () => {
    const src = readRoute('app/api/slack/callback/route.ts')
    expect(src).toContain('upsertIntegration')
  })
})

describe('Telegram webhook routes', () => {
  it('register route exists and exports POST', () => {
    const src = readRoute('app/api/telegram/register/route.ts')
    expect(src).toContain('export async function POST')
  })

  it('webhook route exists and exports POST', () => {
    const src = readRoute('app/api/telegram/webhook/route.ts')
    expect(src).toContain('export async function POST')
  })

  it('webhook route validates the shared secret (per platform) before processing', () => {
    const src = readRoute('app/api/telegram/webhook/route.ts')
    expect(src).toContain("getIntegrationByBotSecret(secretToken, 'telegram')")
  })

  it('webhook route uses ingest pipeline', () => {
    const src = readRoute('app/api/telegram/webhook/route.ts')
    expect(src).toContain('processCommunityMessage')
  })
})

describe('Schema: ROI columns', () => {
  it('orgs schema has roiMinutesPerTicket column', () => {
    const schemaFile = fs.readFileSync(path.join(ROOT, 'lib/db/schema.ts'), 'utf-8')
    expect(schemaFile).toContain('roiMinutesPerTicket')
  })

  it('orgs schema has roiStaffHourlyRate column', () => {
    const schemaFile = fs.readFileSync(path.join(ROOT, 'lib/db/schema.ts'), 'utf-8')
    expect(schemaFile).toContain('roiStaffHourlyRate')
  })
})

describe('lib/db/migrate.ts: custom migrations runner', () => {
  it('migrate.ts uses __custom_migrations tracking table', () => {
    const file = fs.readFileSync(path.join(ROOT, 'lib/db/migrate.ts'), 'utf-8')
    expect(file).toContain('__custom_migrations')
  })

  it('migrate.ts delegates DB connection to getDb (DATABASE_URL is in drizzle.ts)', () => {
    const file = fs.readFileSync(path.join(ROOT, 'lib/db/migrate.ts'), 'utf-8')
    expect(file).toContain('getDb')
  })

  it('migrate.ts reads SQL files from drizzle directory', () => {
    const file = fs.readFileSync(path.join(ROOT, 'lib/db/migrate.ts'), 'utf-8')
    expect(file).toContain('drizzle')
    expect(file).toContain('.sql')
  })
})
