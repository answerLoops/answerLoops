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

describe('railway.toml: deployment config', () => {
  const TOML_PATH = path.join(ROOT, 'railway.toml')

  it('railway.toml exists', () => {
    expect(fs.existsSync(TOML_PATH)).toBe(true)
  })

  it('railway.toml specifies startCommand', () => {
    const content = fs.readFileSync(TOML_PATH, 'utf-8')
    expect(content).toContain('startCommand')
  })

  it('railway.toml uses nixpacks builder', () => {
    const content = fs.readFileSync(TOML_PATH, 'utf-8')
    expect(content).toContain('nixpacks')
  })

  it('railway.toml has on_failure restart policy', () => {
    const content = fs.readFileSync(TOML_PATH, 'utf-8')
    expect(content).toContain('on_failure')
  })
})
