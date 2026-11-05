import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { orgs } from '@/lib/db/schema'

/**
 * Infrastructure coverage for the stable widget slug: how 0073 behaves under
 * lib/db/migrate.ts, that the drizzle schema names the same column and index
 * as the SQL, the config route's id routing and rate-limit key, the loader's
 * use of the resolved token, and that a token rotation leaves the slug alone.
 * Assertions already made in widget-slug*.test.ts, widget-config-route.test.ts
 * and widget-loader-config.test.ts are not repeated.
 */

const h = vi.hoisted(() => ({
  getOrgByWidgetToken: vi.fn(),
  getOrgByWidgetSlug: vi.fn(),
  orgHasFeature: vi.fn(),
  rateLimitShared: vi.fn(),
}))
vi.mock('@/lib/db/queries/widgets', () => ({
  getOrgByWidgetToken: h.getOrgByWidgetToken,
  getOrgByWidgetSlug: h.getOrgByWidgetSlug,
}))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.orgHasFeature }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/http/origin-guard', () => ({ verifyOriginProxy: () => null }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))


const ROOT = process.cwd()
const DIR = path.join(ROOT, 'drizzle')
const FILE = '0073_widget_slug.sql'
const raw = fs.readFileSync(path.join(DIR, FILE), 'utf8')

const code = (s: string) =>
  s
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')

describe(`${FILE} under the migration runner`, () => {
  const chunks = raw
    .split('--> statement-breakpoint')
    .map((c) => code(c).replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  it('the runner still sorts by name and splits only on the breakpoint marker', () => {
    const runner = fs.readFileSync(path.join(ROOT, 'lib/db/migrate.ts'), 'utf8')
    expect(runner).toContain(".filter((f) => f.endsWith('.sql'))")
    expect(runner).toContain('.sort()')
    expect(runner).toContain(".split('--> statement-breakpoint')")
  })

  it('has exactly one statement per breakpoint chunk, each terminated', () => {
    expect(chunks).toHaveLength(2)
    for (const c of chunks) {
      expect(c.endsWith(';'), c).toBe(true)
      expect(c.split(';').filter(Boolean)).toHaveLength(1)
    }
  })

  it('every statement is idempotent, so a re-run on a migrated database is a no-op', () => {
    expect(chunks[0]).toMatch(/^ALTER TABLE orgs ADD COLUMN IF NOT EXISTS widget_slug TEXT;$/)
    expect(chunks[1]).toMatch(/^CREATE UNIQUE INDEX IF NOT EXISTS orgs_widget_slug_key /)
    expect(code(raw)).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i)
  })

  it('orders the column before the index that depends on it', () => {
    expect(chunks[0]).toContain('ADD COLUMN')
    expect(chunks[1]).toContain('CREATE UNIQUE INDEX')
  })

  it('is the only 0073 and migration numbers are unique and contiguous', () => {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
    expect(files.filter((f) => f.startsWith('0073_'))).toEqual([FILE])
    const nums = files.map((f) => Number(f.slice(0, 4)))
    expect(new Set(nums).size).toBe(nums.length)
    nums.forEach((n, i) => {
      if (i > 0) expect(n, `gap before ${files[i]}`).toBe(nums[i - 1] + 1)
    })
    expect(files[files.indexOf(FILE) - 1].startsWith('0072_')).toBe(true)
  })
})

describe('schema matches the 0073 SQL', () => {
  it('maps widgetSlug to the widget_slug column, nullable text', () => {
    const cfg = getTableConfig(orgs)
    const col = cfg.columns.find((c) => c.name === 'widget_slug')
    expect(col).toBeDefined()
    expect(col!.notNull).toBe(false)
    expect(col!.getSQLType()).toBe('text')
    expect(orgs.widgetSlug.name).toBe('widget_slug')
    expect(raw).toContain(`ADD COLUMN IF NOT EXISTS ${col!.name} TEXT`)
  })
})

describe('GET /api/widget/config: slug routing and rate-limit key', () => {
  const TOKEN = 'a1'.repeat(24)
  const CURRENT = 'c3'.repeat(24)
  const org = (token: string) => ({
    id: 7,
    name: 'Acme',
    widget_token: token,
    plan_id: 'pro',
    widget_allowed_origins: null,
    widget_lead_capture_mode: 'on-failure',
  })

  async function call(id: string) {
    const { GET } = await import('@/app/api/widget/config/route')
    const url = new URL('https://app.test/api/widget/config')
    url.searchParams.set('id', id)
    return GET(new Request(url))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    h.rateLimitShared.mockResolvedValue({ ok: true })
    h.orgHasFeature.mockResolvedValue(true)
    h.getOrgByWidgetToken.mockResolvedValue(org(TOKEN))
    h.getOrgByWidgetSlug.mockResolvedValue(org(CURRENT))
  })

  it('a slug id resolves only through the slug lookup and returns that org\'s current token', async () => {
    const body = await (await call('acme-help')).json()
    expect(body.token).toBe(CURRENT)
    expect(h.getOrgByWidgetSlug).toHaveBeenCalledExactlyOnceWith('acme-help')
    expect(h.getOrgByWidgetToken).not.toHaveBeenCalled()
  })

  it('a token id goes only to the token lookup', async () => {
    const body = await (await call(TOKEN)).json()
    expect(body.token).toBe(TOKEN)
    expect(h.getOrgByWidgetToken).toHaveBeenCalledExactlyOnceWith(TOKEN)
    expect(h.getOrgByWidgetSlug).not.toHaveBeenCalled()
  })

  it('a slug that is not found returns token null with defaults and a 200', async () => {
    h.getOrgByWidgetSlug.mockResolvedValue(null)
    const res = await call('nobody-here')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBeNull()
    expect(body.display).toEqual({ windowSize: 'small', bubbleColor: '#4f46e5' })
    expect(h.orgHasFeature).not.toHaveBeenCalled()
  })

  it.each([
    ['reserved', 'support'],
    ['reserved (product name)', 'answerloops'],
    ['overlong', 'a'.repeat(41)],
    ['uppercase', 'Acme-Help'],
    ['too short', 'ab'],
    ['path-like', 'acme/help'],
    ['empty', ''],
  ])('a %s id never reaches the database or the limiter', async (_n, id) => {
    const res = await call(id)
    expect(res.status).toBe(200)
    expect((await res.json()).token).toBeNull()
    expect(h.getOrgByWidgetSlug).not.toHaveBeenCalled()
    expect(h.getOrgByWidgetToken).not.toHaveBeenCalled()
    expect(h.rateLimitShared).not.toHaveBeenCalled()
  })

  it('builds the per-id rate-limit key from the validated, trimmed id', async () => {
    await call('  acme-help  ')
    const keys = h.rateLimitShared.mock.calls.map((c) => c[0])
    expect(keys).toContain('widget-config-id:acme-help')
    expect(keys).toContain('widget-config-ip:203.0.113.9')
    expect(h.getOrgByWidgetSlug).toHaveBeenCalledWith('acme-help')
  })
})

describe('public/widget.js: using the resolved token', () => {
  const SOURCE = fs.readFileSync(path.join(ROOT, 'public/widget.js'), 'utf8')
  const RESOLVED = 'd4'.repeat(24)

  interface El {
    id: string
    src: string
    textContent: string
    attrs: Record<string, string>
    children: El[]
    [k: string]: unknown
  }
  const el = (): El => {
    const e: El = {
      id: '',
      src: '',
      textContent: '',
      innerHTML: '',
      title: '',
      attrs: {},
      children: [],
      setAttribute: (k: string, v: string) => {
        e.attrs[k] = v
      },
      getAttribute: (k: string) => (k in e.attrs ? e.attrs[k] : null),
      addEventListener: () => {},
      appendChild: (c: El) => {
        e.children.push(c)
      },
      classList: { add() {}, remove() {} },
    }
    return e
  }

  function run(widgetId: string, config: unknown) {
    const script = el()
    script.attrs['data-base-url'] = 'https://app.test'
    script.attrs['data-widget-id'] = widgetId
    const head = el()
    const body = el()
    const sandbox: Record<string, unknown> = {
      document: {
        currentScript: script,
        readyState: 'complete',
        head,
        body,
        createElement: () => el(),
        getElementsByTagName: () => [script],
        addEventListener: () => {},
      },
      location: { origin: 'https://customer.test' },
      setTimeout,
      clearTimeout,
      Promise,
      AbortController,
      encodeURIComponent,
      Object,
      fetch: async () => ({ ok: true, json: async () => config }),
    }
    sandbox.window = sandbox
    vm.createContext(sandbox)
    vm.runInContext(SOURCE, sandbox)
    return {
      panel: () => body.children.find((c) => c.id === 'cp-widget-panel'),
      bubble: () => body.children.find((c) => c.id === 'cp-widget-bubble'),
      iframeSrc: () => body.children.find((c) => c.id === 'cp-widget-panel')?.children[0]?.src,
    }
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('a slug snippet builds the iframe from the returned token, never the slug', async () => {
    const w = run('acme-help', { token: RESOLVED, display: {} })
    await vi.waitFor(() => expect(w.iframeSrc()).toBe(`https://app.test/widget/${RESOLVED}`))
    expect(w.iframeSrc()).not.toContain('acme-help')
  })

  it('a slug snippet with a null token builds nothing', async () => {
    const w = run('acme-help', { token: null, display: {} })
    await new Promise((r) => setTimeout(r, 30))
    expect(w.panel()).toBeUndefined()
    expect(w.bubble()).toBeUndefined()
  })
})

describe('rotating the token leaves the slug alone', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/db/queries/widgets.ts'), 'utf8')
  const fnBody = (name: string) => {
    const start = src.indexOf(`export async function ${name}`)
    expect(start, `${name} exists`).toBeGreaterThan(-1)
    const next = src.indexOf('\nexport ', start + 1)
    return src.slice(start, next === -1 ? undefined : next)
  }

  it('rotateWidgetToken and ensureWidgetToken write only the token columns', () => {
    const rotate = fnBody('rotateWidgetToken')
    expect(rotate).toContain('.set({ widgetToken: token, widgetTokenExpiresAt: expiresAt })')
    expect(rotate).not.toMatch(/widgetSlug|widget_slug/)
    expect(fnBody('ensureWidgetToken')).not.toMatch(/widgetSlug|widget_slug/)
  })

  it('setWidgetSlug does not touch the token columns', () => {
    const set = fnBody('setWidgetSlug')
    expect(set).toContain('widgetSlug')
    expect(set).not.toMatch(/widgetToken\b|widgetTokenExpiresAt/)
  })
})
