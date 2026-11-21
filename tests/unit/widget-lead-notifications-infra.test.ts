import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Source-level wiring for the website chat lead emails: the migration, the
 * schema, the queries, the sweep endpoint and the bot sweep have to agree. A
 * missing link fails quietly (leads that are never emailed) rather than loudly.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')

describe('migration 0080', () => {
  const sql = read('drizzle/0080_widget_lead_notifications.sql')

  it('adds the per-lead and per-workspace columns', () => {
    expect(sql).toMatch(/ALTER TABLE widget_leads ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ DEFAULT now\(\);/)
    expect(sql).toMatch(/ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_leads_emailed_at TIMESTAMPTZ;/)
  })

  it('marks the leads that already exist as notified, then makes new leads start as waiting', () => {
    // The default fills the existing rows once; dropping it straight after means
    // a lead saved from now on starts as NULL (not yet emailed).
    const add = sql.indexOf('ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ DEFAULT now()')
    const drop = sql.indexOf('ALTER COLUMN notified_at DROP DEFAULT')
    expect(add).toBeGreaterThan(-1)
    expect(drop).toBeGreaterThan(add)
  })

  it('can be applied twice', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_widget_leads_pending/)
    expect(sql).not.toMatch(/NOT NULL/)
  })

  it('has a number nothing else uses', () => {
    const same = fs.readdirSync(path.join(process.cwd(), 'drizzle')).filter((f) => f.startsWith('0080_'))
    expect(same).toEqual(['0080_widget_lead_notifications.sql'])
  })
})

describe('schema and queries', () => {
  it('declares the columns with the same names as the migration', () => {
    const schema = read('lib/db/schema.ts')
    expect(schema).toContain("notifiedAt: timestamp('notified_at', { withTimezone: true })")
    expect(schema).toContain("widgetLeadsEmailedAt: timestamp('widget_leads_emailed_at', { withTimezone: true })")
  })

  it('tells a first submission from a repeat in the same statement that saves it', () => {
    const q = read('lib/db/queries/widget-leads.ts')
    expect(q).toContain('(xmax = 0)')
    expect(q).toContain('isNew')
  })

  it('claims the workspace window with one conditional UPDATE, and only marks leads up to the ones it listed', () => {
    const q = read('lib/db/queries/widget-leads.ts')
    expect(q).toMatch(/UPDATE orgs SET widget_leads_emailed_at = now\(\)/)
    expect(q).toMatch(/widget_leads_emailed_at IS NULL/)
    expect(q).toMatch(/lte\(widgetLeads\.id, maxId\)/)
  })
})

describe('sweep endpoint', () => {
  const route = read('app/api/widget/lead-notifications/run/route.ts')

  it('requires the platform bot secret', () => {
    expect(route).toContain('isPlatformBotRequest(request)')
    expect(route).toMatch(/status|new Response\('Unauthorized', \{ status: 401 \}\)/)
  })

  it('is under a path that does not need a signed-in session', () => {
    const auth = read('auth.ts')
    expect(auth).toContain("'/api/widget'")
  })
})

describe('sweep endpoint behavior', () => {
  const h = vi.hoisted(() => ({ isBot: vi.fn(), run: vi.fn() }))
  vi.mock('@/lib/http/bearer-auth', () => ({ isPlatformBotRequest: h.isBot }))
  vi.mock('@/lib/widget/lead-notifications', () => ({ runWidgetLeadDigests: h.run }))

  beforeEach(() => {
    vi.clearAllMocks()
    h.run.mockResolvedValue({ considered: 2, sent: 2, failed: 0 })
  })

  it('refuses a caller without the secret and runs nothing', async () => {
    h.isBot.mockReturnValue(false)
    const { POST } = await import('@/app/api/widget/lead-notifications/run/route')
    const res = await POST(new Request('https://app.test/api/widget/lead-notifications/run', { method: 'POST' }))
    expect(res.status).toBe(401)
    expect(h.run).not.toHaveBeenCalled()
  })

  it('runs the sweep for the bot and returns its counts', async () => {
    h.isBot.mockReturnValue(true)
    const { POST } = await import('@/app/api/widget/lead-notifications/run/route')
    const res = await POST(new Request('https://app.test/api/widget/lead-notifications/run', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, considered: 2, sent: 2, failed: 0 })
  })

  it('answers 500 without detail when the sweep throws', async () => {
    h.isBot.mockReturnValue(true)
    h.run.mockRejectedValue(new Error('secret detail'))
    const { POST } = await import('@/app/api/widget/lead-notifications/run/route')
    const res = await POST(new Request('https://app.test/api/widget/lead-notifications/run', { method: 'POST' }))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret detail')
  })
})

describe('bot sweep', () => {
  const bot = read('bot/index.ts')

  it('calls the endpoint with the bot secret and is started with the other sweeps', () => {
    expect(bot).toContain('/api/widget/lead-notifications/run')
    const start = bot.indexOf('function startWidgetLeadSweep')
    const body = bot.slice(start, bot.indexOf('\n}\n', start))
    expect(body).toContain('Authorization: `Bearer ${botSecret}`')
    expect(body).toContain('inFlight')
    expect(bot).toMatch(/startTrialReminderSweep\(\)\n\s*startWidgetLeadSweep\(\)/)
  })
})
