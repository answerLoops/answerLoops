import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Real bug found live testing the Slack overhaul: every polled Slack
// message got a ticket created, but the entire background job (push
// notification, email, embedding, duplicate detection, and critically the
// AI agent draft/deflect step) silently never ran, for every self-hosted
// or force-polling org. Root cause: pollChannel called
// processCommunityMessage directly, in the bot's own plain-Node process —
// but lib/ingest/pipeline.ts's after() job uses next/server's after(),
// which throws "called outside a request scope" anywhere other than a
// real Next.js request. Discord never had this bug because its messages
// are forwarded over HTTP to /api/ingest (a real Next.js route, forwardMessage
// in bot/handlers.ts) — the Slack poller just never followed that pattern.
//
// Fixed by making pollChannel forward over HTTP exactly like Discord does.
// That surfaced a second, connected bug: /api/ingest hardcoded
// `platform: 'discord'` unconditionally, so a forwarded Slack message would
// have been mislabeled and its AI reply routed to the wrong channel type —
// closed by accepting an explicit `platform` field, defaulting to 'discord'
// for the existing Discord bot's un-migrated forwardMessage calls.

const ROOT = process.cwd()
function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

const { processCommunityMessage, getIntegrationByBotSecret } = vi.hoisted(() => ({
  processCommunityMessage: vi.fn(async () => ({ ticket_id: 1 })),
  getIntegrationByBotSecret: vi.fn(async (_secret: string, _platform: unknown) => ({ org_id: 3, platform: 'slack' })),
}))

vi.mock('@/lib/ingest/pipeline', () => ({ processCommunityMessage }))
vi.mock('@/lib/db/queries/integrations', () => ({ getIntegrationByBotSecret }))
vi.mock('@/lib/ingest/limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ingest/limits')>()),
  isIngestRateLimited: vi.fn(async () => false),
}))

describe('lib/slack/poller.ts no longer calls processCommunityMessage in-process', () => {
  it('does not import processCommunityMessage at all', () => {
    const src = read('lib/slack/poller.ts')
    expect(src).not.toMatch(/import\s*\{[^}]*processCommunityMessage[^}]*\}/)
    expect(src).not.toContain("from '../ingest/pipeline'")
  })

  it('pollChannel forwards to /api/ingest with the bot secret and an explicit platform field', () => {
    const src = read('lib/slack/poller.ts')
    const fnIdx = src.indexOf('export async function pollChannel')
    const fnBody = src.slice(fnIdx)
    expect(fnBody).toContain('${targetUrl}/api/ingest')
    expect(fnBody).toContain('Authorization: `Bearer ${botSecret}`')
    expect(fnBody).toContain("platform: 'slack'")
  })

  it('pollOrg requires bot_secret before polling and passes it plus BOT_TARGET_URL through', () => {
    const src = read('lib/slack/poller.ts')
    const fnIdx = src.indexOf('async function pollOrg')
    const fnBody = src.slice(fnIdx, src.indexOf('\n}', fnIdx))
    expect(fnBody).toContain('!integration.bot_secret')
    expect(fnBody).toContain('integration.bot_secret!')
    expect(fnBody).toContain("process.env.BOT_TARGET_URL")
  })
})

describe('app/api/ingest/route.ts accepts an explicit platform instead of always hardcoding discord', () => {
  it('the Zod schema declares an optional platform field covering every known platform', () => {
    const src = read('app/api/ingest/route.ts')
    expect(src).toContain("const INGEST_PLATFORMS = ['discord', 'slack'] as const")
    expect(src).toMatch(/platform:\s*z\.enum\(INGEST_PLATFORMS\)\.optional\(\)/)
  })

  it('defaults to discord when platform is omitted, for the existing Discord bot forwarding', () => {
    const src = read('app/api/ingest/route.ts')
    expect(src).toContain("platform ?? allowedPlatform ?? 'discord'")
    // The old unconditional hardcode must be gone, not just supplemented
    expect(src).not.toContain("platform: 'discord',\n  }, orgId)")
  })
})

describe('app/api/ingest/route.ts binds the forwarded platform to the credential', () => {
  async function callRoute(body: Record<string, unknown>) {
    const { POST } = await import('@/app/api/ingest/route')
    return POST(
      new Request('http://localhost/api/ingest', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )
  }

  beforeEach(() => processCommunityMessage.mockClear())

  it('looks the secret up for the discord and slack integrations only', async () => {
    await callRoute({ message_id: 'm', content: 'hello there friend', author_id: 'u', author_name: 'u', channel_id: 'c', platform: 'slack' })
    expect(getIntegrationByBotSecret).toHaveBeenLastCalledWith('secret', ['discord', 'slack'])
  })

  it('rejects a platform that differs from the one the secret belongs to', async () => {
    getIntegrationByBotSecret.mockResolvedValueOnce({ org_id: 3, platform: 'discord' })
    const res = await callRoute({ message_id: 'm', content: 'hello there friend', author_id: 'u', author_name: 'u', channel_id: 'c', platform: 'slack' })
    expect(res.status).toBe(403)
    expect(processCommunityMessage).not.toHaveBeenCalled()
  })

  it('does not accept channels that have their own authenticated route (telegram, email, github, mcp)', async () => {
    for (const platform of ['telegram', 'email', 'github', 'mcp']) {
      const res = await callRoute({ message_id: 'm', content: 'hello there friend', author_id: 'u', author_name: 'u', channel_id: 'c', platform })
      expect(res.status).toBe(400)
    }
    expect(processCommunityMessage).not.toHaveBeenCalled()
  })

  it('rejects a non-http(s) source_url', async () => {
    const res = await callRoute({ message_id: 'm', content: 'hello there friend', author_id: 'u', author_name: 'u', channel_id: 'c', source_url: 'javascript:alert(1)' })
    expect(res.status).toBe(400)
  })
})

describe('processCommunityMessage: platform actually threads through from the ingest route', () => {
  beforeEach(() => {
    processCommunityMessage.mockClear()
  })

  async function callRoute(body: Record<string, unknown>) {
    const { POST } = await import('@/app/api/ingest/route')
    return POST(
      new Request('http://localhost/api/ingest', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )
  }

  it('a Slack-forwarded message is processed with platform "slack", not the old hardcoded "discord"', async () => {
    await callRoute({
      message_id: 'ts-1',
      content: 'a real slack message forwarded over http',
      author_id: 'U1',
      author_name: 'U1',
      channel_id: 'C123',
      platform: 'slack',
    })

    expect(processCommunityMessage).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'slack' }),
      3
    )
  })

  it('a Discord message with no platform field still defaults to "discord"', async () => {
    getIntegrationByBotSecret.mockResolvedValueOnce({ org_id: 3, platform: 'discord' })
    await callRoute({
      message_id: 'm-1',
      content: 'a discord message, no platform field, old bot behavior',
      author_id: 'U1',
      author_name: 'U1',
      channel_id: 'C123',
    })

    expect(processCommunityMessage).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'discord' }),
      3
    )
  })
})
