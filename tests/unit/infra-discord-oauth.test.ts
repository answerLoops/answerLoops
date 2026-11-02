import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Infra tests for Discord 1-click OAuth flow.
// No live DB or Discord calls — source-file assertions only
// (Next.js route modules cannot be imported directly in vitest).

const ROOT = process.cwd()

function readRoute(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `Route not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('Discord OAuth routes: file structure', () => {
  it('callback route file exists and exports GET', () => {
    const src = readRoute('app/api/discord/callback/route.ts')
    expect(src).toContain('export async function GET')
  })

  it('invite-url route file exists and exports GET', () => {
    const src = readRoute('app/api/discord/invite-url/route.ts')
    expect(src).toContain('export async function GET')
  })

  it('guilds route file exists and exports GET', () => {
    const src = readRoute('app/api/discord/guilds/route.ts')
    expect(src).toContain('export async function GET')
  })
})

describe('Discord OAuth state encoding', () => {
  it('invite-url route references DISCORD_CLIENT_ID env var', () => {
    const src = readRoute('app/api/discord/invite-url/route.ts')
    expect(src).toContain('DISCORD_CLIENT_ID')
  })

  it('invite-url route constructs redirect_uri pointing to /api/discord/callback', () => {
    const src = readRoute('app/api/discord/invite-url/route.ts')
    expect(src).toContain('/api/discord/callback')
  })

  it('callback route redirects to /onboarding with discord_connected param', () => {
    const src = readRoute('app/api/discord/callback/route.ts')
    expect(src).toContain('/onboarding')
    expect(src).toContain('discord_connected')
  })

  it('callback route redirects to /integrations with guild_id param on settings flow', () => {
    const src = readRoute('app/api/discord/callback/route.ts')
    expect(src).toContain('/integrations')
    expect(src).toContain('guild_id')
  })

  it('callback route authenticates the state signature and binds it to the caller org', () => {
    const src = readRoute('app/api/discord/callback/route.ts')
    expect(src).toContain('verifyOAuthCallback(')
    expect(src).toContain('caller: { userId: access.userId, orgId: access.orgId }')
    expect(src).toContain('verifyDiscordInstall(')
    // no unsigned base64 decode, no default-org fallback
    expect(src).not.toContain("Buffer.from(state ?? '', 'base64url')")
    expect(src).not.toContain('?? 1')
  })

  it('callback route saves guild via upsertIntegration', () => {
    const src = readRoute('app/api/discord/callback/route.ts')
    expect(src).toContain('upsertIntegration')
  })
})

describe('Railway: app deployment config (Infrastructure as Code)', () => {
  const IAC_PATH = path.join(ROOT, '.railway', 'railway.ts')

  it('.railway/railway.ts exists and the deprecated railway.toml is gone', () => {
    expect(fs.existsSync(IAC_PATH)).toBe(true)
    // Config as Code stops being read on 2026-12-01; a service cannot be
    // managed by both systems, so the old file must not come back.
    expect(fs.existsSync(path.join(ROOT, 'railway.toml'))).toBe(false)
  })

  it('declares the app health check that the deploy gates on', () => {
    const content = fs.readFileSync(IAC_PATH, 'utf-8')
    expect(content).toContain('healthcheck: "/api/health"')
    expect(content).toContain('healthcheckTimeout: 30')
  })

  it('leaves service variables unmanaged so no secret enters the repo', () => {
    const content = fs.readFileSync(IAC_PATH, 'utf-8')
    expect(content).toContain('managed: false')
    expect(content).not.toContain('--include-variables')
    expect(content).not.toMatch(/\benv\s*:/)
  })

  it('is excluded from the app type-check', () => {
    const tsconfig = fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf-8')
    expect(tsconfig).toContain('".railway"')
  })
})

describe('Railway: bot deployment config', () => {
  const BOT_TOML = path.join(ROOT, 'railway.bot.toml')

  // The bot service points at this file in Railway. Without its start command
  // the bot would fall back to the Dockerfile CMD and run the web app instead.
  it('railway.bot.toml still starts the bot, not the web app', () => {
    const content = fs.readFileSync(BOT_TOML, 'utf-8')
    expect(content).toContain('startCommand = "pnpm bot:start"')
  })

  it('railway.bot.toml has on_failure restart policy', () => {
    const content = fs.readFileSync(BOT_TOML, 'utf-8')
    expect(content).toContain('on_failure')
  })
})
