import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Real gap found live: every other ingest platform (Discord, Telegram,
// GitHub) renders a clickable "View in X" link back to the original
// message on the ticket detail page, but Slack rendered a plain,
// non-clickable "Slack · #channel" span — no way for staff to jump back to
// the source conversation. Fixed by calling Slack's chat.getPermalink API
// at ingest time (both the poller and the Events API webhook already have
// the bot token in hand) and storing the result on tickets.source_url.

const ROOT = process.cwd()
function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

describe('lib/slack/permalink.ts — getSlackPermalink', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('returns the permalink on a successful lookup', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      json: async () => ({ ok: true, permalink: 'https://team.slack.com/archives/C123/p1700000000000100' }),
    } as Response)

    const { getSlackPermalink } = await import('@/lib/slack/permalink')
    const url = await getSlackPermalink('xoxb-test', 'C123', '1700000000.000100')

    expect(url).toBe('https://team.slack.com/archives/C123/p1700000000000100')
    const [requestUrl, init] = vi.mocked(global.fetch).mock.calls[0]
    expect(String(requestUrl)).toContain('chat.getPermalink')
    expect(String(requestUrl)).toContain('channel=C123')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer xoxb-test' })
  })

  it('returns null (never throws) when Slack returns ok: false', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      json: async () => ({ ok: false, error: 'message_not_found' }),
    } as Response)

    const { getSlackPermalink } = await import('@/lib/slack/permalink')
    const url = await getSlackPermalink('xoxb-test', 'C123', '1700000000.000100')

    expect(url).toBeNull()
  })

  it('returns null (never throws) when the fetch itself rejects', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('network down'))

    const { getSlackPermalink } = await import('@/lib/slack/permalink')
    const url = await getSlackPermalink('xoxb-test', 'C123', '1700000000.000100')

    expect(url).toBeNull()
  })
})

describe('tickets.source_url is threaded from ingest all the way to the ticket', () => {
  it('schema declares the column, with a migration to match', () => {
    const schemaSrc = read('lib/db/schema.ts')
    expect(schemaSrc).toContain("sourceUrl: text('source_url')")

    const migrationSrc = read('drizzle/0028_ticket_source_url.sql')
    expect(migrationSrc).toContain('ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source_url text')
  })

  it('createTicket writes source_url and toTicket reads it back', () => {
    const src = read('lib/db/queries/tickets.ts')
    expect(src).toContain('sourceUrl: input.source_url ?? null')
    expect(src).toContain('source_url: row.sourceUrl ?? null')
  })

  it('MessagePayload/pipeline threads sourceUrl into createTicket', () => {
    const src = read('lib/ingest/pipeline.ts')
    expect(src).toContain('sourceUrl?: string')
    expect(src).toContain('source_url: sourceUrl,')
  })

  it('the Slack poller resolves a permalink per message and forwards it as source_url', () => {
    const src = read('lib/slack/poller.ts')
    expect(src).toContain('getSlackPermalink(botToken, channelId, msg.ts)')
    expect(src).toContain('source_url: sourceUrl ?? undefined,')
  })

  it('the Slack Events API webhook resolves a permalink and forwards it too', () => {
    const src = read('app/api/slack/events/route.ts')
    expect(src).toContain('getSlackPermalink(botToken, channelId, ts)')
    expect(src).toContain('sourceUrl: sourceUrl ?? undefined,')
  })

  it('/api/ingest accepts source_url and passes it through', () => {
    const src = read('app/api/ingest/route.ts')
    expect(src).toContain('source_url: z')
    expect(src).toContain('.max(2048)')
    expect(src).toContain('sourceUrl: source_url,')
  })

  it('the ticket detail page renders a real Slack link when source_url is present, falling back to plain text otherwise', () => {
    const src = read('app/(dashboard)/tickets/[id]/page.tsx')
    expect(src).toMatch(/source_platform === 'slack' && ticket\.source_channel_id && ticket\.source_url/)
    expect(src).toContain('View in Slack ↗')
    // The no-link fallback must still exist for tickets with no resolved permalink
    expect(src).toMatch(/source_platform === 'slack' && ticket\.source_channel_id \?/)
  })
})
