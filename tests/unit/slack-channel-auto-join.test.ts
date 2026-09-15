import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Importing app/actions/integrations.ts pulls in '@/auth' at module scope,
// which constructs a real NextAuth() instance — that doesn't resolve
// cleanly under vitest outside a full Next.js runtime (same issue hit
// earlier this session testing a component that transitively imported a
// server action module). Mocked here purely so the module can load; none of
// these tests call auth() themselves.
vi.mock('@/auth', () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }))

const { joinSlackChannels } = await import('@/app/actions/integrations')

// Fix for the real bug found while debugging live Slack ingestion: Slack
// never auto-adds a bot to a channel just because a scope was granted — a
// bot has to explicitly call conversations.join (which itself requires the
// channels:join scope). Before this fix, picking a channel in the UI saved
// cleanly but left the bot outside it every time; the poller's
// conversations.history calls then failed with not_in_channel forever, with
// nothing surfacing that anywhere outside a server log. That's exactly the
// "looks configured, silently does nothing" failure mode this project
// doesn't want (see the escalation-user-group Known Issue raised the same
// session, over the same principle).
//
// joinSlackChannels has no dependency on next-auth/DB, so it's tested
// directly against a mocked global.fetch — no need to mock '@/auth' just to
// reach it (this repo has no existing precedent for mocking '@/auth' in a
// unit test, and next-auth doesn't resolve cleanly outside a real Next.js
// runtime, same issue hit earlier this session with a component test that
// transitively pulled in the real module).

const ROOT = process.cwd()

function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

describe('joinSlackChannels', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('calls conversations.join for every channel with the bot token', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      json: async () => ({ ok: true }),
    } as Response)

    await joinSlackChannels('xoxb-test-token', ['C1', 'C2'])

    expect(global.fetch).toHaveBeenCalledTimes(2)
    const [url, init] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toBe('https://slack.com/api/conversations.join')
    expect((init as RequestInit).method).toBe('POST')
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer xoxb-test-token')
  })

  it('reports every failed channel — nothing is silently dropped', async () => {
    vi.mocked(global.fetch).mockImplementation(async (_url, init) => {
      const body = new URLSearchParams((init as RequestInit).body as string)
      const channel = body.get('channel')
      if (channel === 'C-private') {
        return { json: async () => ({ ok: false, error: 'channel_not_found' }) } as Response
      }
      return { json: async () => ({ ok: true }) } as Response
    })

    const { failed } = await joinSlackChannels('xoxb-test-token', ['C-public', 'C-private'])

    expect(failed).toEqual([{ channelId: 'C-private', error: 'channel_not_found' }])
  })

  it('reports a network failure as a failed channel rather than throwing', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('fetch failed'))

    const { failed } = await joinSlackChannels('xoxb-test-token', ['C1'])

    expect(failed).toEqual([{ channelId: 'C1', error: 'network_error' }])
  })

  it('returns no failures when every channel joins successfully', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ json: async () => ({ ok: true }) } as Response)

    const { failed } = await joinSlackChannels('xoxb-test-token', ['C1', 'C2', 'C3'])

    expect(failed).toEqual([])
  })
})

describe('OAuth scope request includes channels:join', () => {
  it('app/api/slack/install/route.ts requests channels:join, not just the app dashboard config', () => {
    const src = read('app/api/slack/install/route.ts')
    // The dashboard's configured Bot Token Scopes are not what gets granted —
    // the `scope` query param on the OAuth authorize URL is. Adding the scope
    // in Slack's app config alone would silently do nothing without this.
    expect(src).toMatch(/const SCOPES = '[^']*channels:join[^']*'/)
  })
})

describe('saveSlackChannelsAction and saveSlackIntegrationAction surface join failures as a warning, never swallow them', () => {
  const src = read('app/actions/integrations.ts')

  it('saveSlackChannelsAction calls joinSlackChannels and returns a warning on partial failure', () => {
    const idx = src.indexOf('export async function saveSlackChannelsAction')
    const body = src.slice(idx, src.indexOf('\n}', src.indexOf('return warning', idx)))
    expect(body).toContain('joinSlackChannels(existing.bot_token, channelIds)')
    expect(body).toContain('return warning ? { warning } : null')
  })

  it('saveSlackIntegrationAction (manual/polling connect) gets the same auto-join treatment', () => {
    const idx = src.indexOf('export async function saveSlackIntegrationAction')
    const body = src.slice(idx, src.indexOf('\n}', src.indexOf('return warning', idx)))
    expect(body).toContain('joinSlackChannels(botToken, channelIdList)')
    expect(body).toContain('return warning ? { warning } : null')
  })
})

describe('Slack settings: Events API endpoint only shown to self-hosted deployments', () => {
  const src = read('components/settings/slack.tsx')

  it('gates the endpoint block on deployment mode instead of showing it to every org', () => {
    expect(src).toContain('getCurrentDeploymentMode()')
    expect(src).toContain("setSelfHosted(mode === 'self-hosted')")
    const idx = src.indexOf('Events API endpoint (for webhook mode)')
    // The block must be inside a `{selfHosted && (...)}` guard, not rendered unconditionally.
    expect(src.slice(idx - 200, idx)).toContain('{selfHosted && (')
  })
})
