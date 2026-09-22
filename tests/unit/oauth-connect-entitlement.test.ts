import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Known Issues item 47 (Roadmap): the Discord/Slack OAuth connect endpoints
// bypassed the entitlement gate that existed only in the settings-page server
// actions (lib/actions/integrations.ts) — the actual routes that generate the
// OAuth URL and persist the integration on callback checked session only,
// never orgHasFeature. Source-shape assertions, matching this repo's
// convention (see tests/unit/agent-api.test.ts).

const ROOT = process.cwd()

function readSrc(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('app/api/discord/invite-url/route.ts — auth + entitlement', () => {
  const src = () => readSrc('app/api/discord/invite-url/route.ts')

  it('resolves the org from a real membership row and rejects a session without one', () => {
    const s = src()
    const accessIdx = s.indexOf('const access = await requireOrgAccess()')
    const guardIdx = s.indexOf('if (!access.ok)')
    const orgIdIdx = s.indexOf('const { orgId } = access')
    expect(accessIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeGreaterThan(accessIdx)
    expect(orgIdIdx).toBeGreaterThan(guardIdx)
    // no default-org fallback anywhere in the file
    expect(s).not.toContain('DEFAULT_ORG_ID')
  })

  it('checks discord_integration before building the OAuth URL', () => {
    const s = src()
    const checkIdx = s.indexOf("orgHasFeature(orgId, 'discord_integration')")
    const urlBuildIdx = s.indexOf('const url = `https://discord.com')
    expect(checkIdx).toBeGreaterThan(-1)
    expect(checkIdx).toBeLessThan(urlBuildIdx)

    const checkBlock = s.slice(checkIdx, checkIdx + 220)
    expect(checkBlock).toContain('403')
  })
})

describe('app/api/discord/callback/route.ts — entitlement before persisting', () => {
  const src = () => readSrc('app/api/discord/callback/route.ts')

  it('imports orgHasFeature', () => {
    expect(src()).toContain("import { orgHasFeature } from '@/lib/billing/entitlements-server'")
  })

  it('checks discord_integration before addDiscordGuild or upsertIntegration run', () => {
    const s = src()
    const checkIdx = s.indexOf("orgHasFeature(orgId, 'discord_integration')")
    const upsertIdx = s.indexOf('await upsertIntegration(')
    const addGuildIdx = s.indexOf('await addDiscordGuild(')
    expect(checkIdx).toBeGreaterThan(-1)
    expect(checkIdx).toBeLessThan(upsertIdx)
    expect(checkIdx).toBeLessThan(addGuildIdx)
  })
})

describe('app/api/slack/install/route.ts — entitlement before building OAuth URL', () => {
  const src = () => readSrc('app/api/slack/install/route.ts')

  it('imports orgHasFeature', () => {
    expect(src()).toContain("import { orgHasFeature } from '@/lib/billing/entitlements-server'")
  })

  it('checks slack_integration after auth but before the OAuth URL is built', () => {
    const s = src()
    const authIdx = s.indexOf('if (!access.ok)')
    const checkIdx = s.indexOf("orgHasFeature(orgId, 'slack_integration')")
    const urlBuildIdx = s.indexOf("new URL('https://slack.com")
    expect(checkIdx).toBeGreaterThan(authIdx)
    expect(checkIdx).toBeLessThan(urlBuildIdx)

    const checkBlock = s.slice(checkIdx, checkIdx + 220)
    expect(checkBlock).toContain('403')
  })
})

describe('app/api/slack/callback/route.ts — entitlement before token exchange', () => {
  const src = () => readSrc('app/api/slack/callback/route.ts')

  it('imports orgHasFeature', () => {
    expect(src()).toContain("import { orgHasFeature } from '@/lib/billing/entitlements-server'")
  })

  it('checks slack_integration before exchanging the OAuth code for a token', () => {
    const s = src()
    const checkIdx = s.indexOf("orgHasFeature(orgId, 'slack_integration')")
    const tokenExchangeIdx = s.indexOf("fetch('https://slack.com/api/oauth.v2.access'")
    const upsertIdx = s.indexOf('await upsertIntegration(')
    expect(checkIdx).toBeGreaterThan(-1)
    expect(checkIdx).toBeLessThan(tokenExchangeIdx)
    expect(checkIdx).toBeLessThan(upsertIdx)
  })
})
