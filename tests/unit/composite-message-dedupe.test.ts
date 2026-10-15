import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { tickets, emailMessages, integrations } from '@/lib/db/schema'
import { telegramSourceMessageId, telegramMessageIdFromSource } from '@/lib/telegram/message-id'

// Module mocks for the Telegram webhook tests below. vitest hoists these
// either way; they live at the top level so that is where they read as running.
const h = vi.hoisted(() => ({
  getIntegrationByBotSecret: vi.fn(),
  getTicketBySourceMessageInChannel: vi.fn(),
  processCommunityMessage: vi.fn(async () => ({ ticket_id: 1 })),
}))
vi.mock('@/lib/db/queries/integrations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/queries/integrations')>()),
  getIntegrationByBotSecret: h.getIntegrationByBotSecret,
}))
vi.mock('@/lib/db/queries/tickets', () => ({ getTicketBySourceMessageInChannel: h.getTicketBySourceMessageInChannel }))
vi.mock('@/lib/ingest/pipeline', () => ({ processCommunityMessage: h.processCommunityMessage }))
vi.mock('@/lib/ingest/limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ingest/limits')>()),
  isIngestRateLimited: vi.fn(async () => false),
}))

// Message ids are only unique within one org (and, for Telegram, within one
// chat), so de-duplication keys are composite and a lost insert race is
// reported as a duplicate rather than an error.

describe('schema: dedupe keys are org-scoped', () => {
  it('tickets has a unique (org_id, source_message_id) index and no single-column unique on source_message_id', () => {
    const cfg = getTableConfig(tickets)
    const idx = cfg.indexes.find((i) => i.config.name === 'tickets_org_source_message_unique')
    expect(idx?.config.unique).toBe(true)
    expect(idx?.config.columns.map((c) => (c as { name: string }).name)).toEqual(['org_id', 'source_message_id'])
    expect(cfg.uniqueConstraints.some((u) => u.columns.some((c) => c.name === 'source_message_id'))).toBe(false)
  })

  it('email_messages has a unique (org_id, rfc_message_id) index and no single-column unique on rfc_message_id', () => {
    const cfg = getTableConfig(emailMessages)
    const idx = cfg.indexes.find((i) => i.config.name === 'email_messages_org_rfc_message_unique')
    expect(idx?.config.unique).toBe(true)
    expect(idx?.config.columns.map((c) => (c as { name: string }).name)).toEqual(['org_id', 'rfc_message_id'])
    expect(cfg.uniqueConstraints.some((u) => u.columns.some((c) => c.name === 'rfc_message_id'))).toBe(false)
  })

  it('integrations has a partial unique (platform, team_id) index limited to enabled slack/discourse/google_chat rows', () => {
    const idx = getTableConfig(integrations).indexes.find((i) => i.config.name === 'integrations_platform_team_enabled_unique')
    expect(idx?.config.unique).toBe(true)
    expect(idx?.config.columns.map((c) => (c as { name: string }).name)).toEqual(['platform', 'team_id'])
    expect(idx?.config.where).toBeDefined()
  })
})

describe('migration 0048 swaps the single-column keys for composite ones', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'drizzle/0048_org_scoped_message_dedupe.sql'), 'utf-8')

  it('drops whatever unique constraint covers the old single columns, by catalog lookup', () => {
    expect(sql).toContain("rel.relname = 'tickets'")
    expect(sql).toContain("a.attname = 'source_message_id'")
    expect(sql).toContain("rel.relname = 'email_messages'")
    expect(sql).toContain("a.attname = 'rfc_message_id'")
    expect(sql).toContain('DROP CONSTRAINT')
  })

  it('creates the composite unique indexes', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS tickets_org_source_message_unique ON tickets (org_id, source_message_id)')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS email_messages_org_rfc_message_unique ON email_messages (org_id, rfc_message_id)')
  })

  it('creates the composite indexes after the old constraints are dropped', () => {
    expect(sql.indexOf('DROP CONSTRAINT')).toBeLessThan(sql.indexOf('CREATE UNIQUE INDEX'))
  })
})

describe('migration 0049 never fails on, or silently rewrites, existing duplicate rows', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'drizzle/0049_integration_site_binding.sql'), 'utf-8')

  it('reports duplicates as a warning and only creates the index when there are none', () => {
    expect(sql).toContain('HAVING count(*) > 1')
    expect(sql).toContain('RAISE WARNING')
    expect(sql).toContain('IF dup_count = 0 THEN')
    expect(sql).not.toMatch(/\bDELETE\b/i)
    expect(sql).not.toMatch(/UPDATE integrations/i)
  })
})

describe('Telegram message ids are namespaced by chat for new tickets', () => {
  it('builds telegram:<chatId>:<messageId> and recovers the bare id from either form', () => {
    expect(telegramSourceMessageId('-1001234', 55)).toBe('telegram:-1001234:55')
    expect(telegramMessageIdFromSource('telegram:-1001234:55')).toBe('55')
    expect(telegramMessageIdFromSource('55')).toBe('55')
  })
})

describe('Telegram webhook', () => {
  function update(text = 'a question that is long enough', messageId = 9, chatId = -100777) {
    return new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'org-secret' },
      body: JSON.stringify({
        update_id: 1,
        message: { message_id: messageId, from: { id: 5, first_name: 'Sam' }, chat: { id: chatId, type: 'supergroup' }, text, date: 1 },
      }),
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    h.getIntegrationByBotSecret.mockResolvedValue({ org_id: 3, platform: 'telegram', channel_ids: null })
    h.getTicketBySourceMessageInChannel.mockResolvedValue(null)
  })

  it('creates new tickets under telegram:<chatId>:<messageId>', async () => {
    const { POST } = await import('@/app/api/telegram/webhook/route')
    await POST(update() as never)
    expect(h.processCommunityMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'telegram:-100777:9', channelId: '-100777', platform: 'telegram' }),
      3
    )
  })

  it('treats a message already stored under the legacy bare id (same chat, same org) as a duplicate', async () => {
    h.getTicketBySourceMessageInChannel.mockResolvedValue({ id: 40 })
    const { POST } = await import('@/app/api/telegram/webhook/route')
    const res = await POST(update() as never)
    expect(res.status).toBe(200)
    expect(h.getTicketBySourceMessageInChannel).toHaveBeenCalledWith('9', '-100777', 3)
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })

  it('answers 401 and nothing else for an unknown secret (no diagnostics, no table scan)', async () => {
    h.getIntegrationByBotSecret.mockResolvedValue(null)
    const { POST } = await import('@/app/api/telegram/webhook/route')
    const res = await POST(update() as never)
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Unauthorized')
    expect(h.getIntegrationByBotSecret).toHaveBeenCalledWith('org-secret', 'telegram')
    expect(h.processCommunityMessage).not.toHaveBeenCalled()
  })

  it('no longer reads the integrations table or logs secret fragments', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/api/telegram/webhook/route.ts'), 'utf-8')
    expect(src).not.toMatch(/secretPrefix|secretSuffix|secretLength|receivedPrefix|storedRows/)
    expect(src).not.toContain('getDb')
    expect(src).not.toContain('@/lib/db/schema')
  })
})
