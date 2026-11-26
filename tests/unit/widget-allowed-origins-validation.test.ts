import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isEmbedAllowed, isListableHost, parseAllowedOrigins, splitAllowedOrigins } from '@/lib/widget/origin'

/**
 * Which entries an owner may list as the widget's allowed domains
 * (lib/widget/origin.ts), how a stored list is read, how a match on this
 * instance's own host is reported, and saveWidgetOriginsAction refusing a list
 * with an unusable entry rather than saving part of it.
 */

const SELF = 'app.test'

describe('isListableHost', () => {
  it.each(['example.com', 'docs.example.com', 'example.co.uk', 'localhost', '127.0.0.1', '10.0.0.12', '[::1]'])(
    'accepts %s',
    (host) => {
      expect(isListableHost(host)).toBe(true)
    }
  )

  it.each(['com', 'dev', 'intranet', '.com', 'example..com', 'example.com.'])(
    'refuses %j, which is a whole top-level domain or has an empty label',
    (host) => {
      expect(isListableHost(host)).toBe(false)
    }
  )

  it.each(['co.uk', 'com.au', 'github.io', 'vercel.app', 'netlify.app', 'pages.dev', 'herokuapp.com'])(
    'refuses %s, an ending shared by many unrelated sites',
    (host) => {
      expect(isListableHost(host)).toBe(false)
    }
  )

  it.each(['acme.co.uk', 'shop.com.au', 'acme.github.io', 'acme.vercel.app', 'docs.acme.pages.dev', 'intranet.corp'])(
    'accepts %s, one site under such an ending or under an unlisted one',
    (host) => {
      expect(isListableHost(host)).toBe(true)
    }
  )
})

describe('splitAllowedOrigins', () => {
  it('normalizes and de-duplicates usable entries, keeping their order', () => {
    expect(splitAllowedOrigins('https://Example.com/path\nexample.com, docs.example.com\n\n  ')).toEqual({
      origins: ['example.com', 'docs.example.com'],
      rejected: [],
    })
  })

  it('reports single-label entries exactly as typed, and keeps the usable ones apart', () => {
    expect(splitAllowedOrigins('example.com\n  COM \nhttps://dev\nlocalhost')).toEqual({
      origins: ['example.com', 'localhost'],
      rejected: ['COM', 'https://dev'],
    })
  })

  it('reports an entry that is not a host at all', () => {
    const { origins, rejected } = splitAllowedOrigins('example.com, http://exa mple.com')
    expect(origins).toEqual(['example.com'])
    expect(rejected).toEqual(['http://exa mple.com'])
  })

  it('returns nothing for empty input', () => {
    expect(splitAllowedOrigins(null)).toEqual({ origins: [], rejected: [] })
    expect(splitAllowedOrigins(undefined)).toEqual({ origins: [], rejected: [] })
    expect(splitAllowedOrigins(' \n , ')).toEqual({ origins: [], rejected: [] })
  })
})

describe('parseAllowedOrigins on a stored list', () => {
  it('drops single-label entries saved before they were refused, so they match nothing', () => {
    const allowed = parseAllowedOrigins('com\nexample.com')
    expect(allowed).toEqual(['example.com'])
    expect(isEmbedAllowed('anything.com', allowed, SELF).allowed).toBe(false)
    expect(isEmbedAllowed('docs.example.com', allowed, SELF).allowed).toBe(true)
  })

  it('drops a stored shared ending such as vercel.app, so it no longer covers every site under it', () => {
    const allowed = parseAllowedOrigins('vercel.app\nacme.vercel.app')
    expect(allowed).toEqual(['acme.vercel.app'])
    expect(isEmbedAllowed('other.vercel.app', allowed, SELF).allowed).toBe(false)
    expect(isEmbedAllowed('acme.vercel.app', allowed, SELF).allowed).toBe(true)
  })

  it('treats a stored list of only unusable entries as no list', () => {
    expect(isEmbedAllowed('shop.test', parseAllowedOrigins('test'), SELF)).toEqual({
      allowed: false,
      reason: 'not-configured',
    })
  })
})

describe('isEmbedAllowed: own-host matches are marked', () => {
  it('marks an allowed render on this instance\'s own host with viaOwnHost', () => {
    expect(isEmbedAllowed(SELF, [], SELF)).toEqual({ allowed: true, viaOwnHost: true })
    expect(isEmbedAllowed(SELF, ['acme.test'], SELF)).toEqual({ allowed: true, viaOwnHost: true })
  })

  it('does not mark a render allowed by the listed domains', () => {
    const decision = isEmbedAllowed('acme.test', ['acme.test'], SELF)
    expect(decision).toEqual({ allowed: true })
    expect(decision.viaOwnHost).toBeUndefined()
  })

  it('with no own host, decides the same page on the listed domains alone', () => {
    expect(isEmbedAllowed(SELF, [], null)).toEqual({ allowed: false, reason: 'not-configured' })
    expect(isEmbedAllowed(SELF, ['acme.test'], null)).toEqual({ allowed: false, reason: 'origin-not-allowed' })
    expect(isEmbedAllowed(SELF, [SELF], null)).toEqual({ allowed: true })
  })
})

// ---------------------------------------------------------------------------
// saveWidgetOriginsAction
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  setWidgetAllowedOrigins: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess: h.requireOrgAccess }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: vi.fn(async () => false) }))
vi.mock('@/lib/db/queries/widget-logos', () => ({
  getWidgetLogoVersion: vi.fn(async () => null),
  deleteWidgetLogo: vi.fn(async () => undefined),
}))
vi.mock('@/lib/db/queries/widgets', () => ({
  getWidgetAppearance: vi.fn(),
  getWidgetDailyAnswerLimit: vi.fn(),
  setWidgetDailyAnswerLimit: vi.fn(),
  setWidgetAppearance: vi.fn(),
  setWidgetSlug: vi.fn(),
  getWidgetSlug: vi.fn(),
  ensureWidgetToken: vi.fn(),
  getWidgetAllowedOrigins: vi.fn(),
  getWidgetLeadCaptureMode: vi.fn(),
  setWidgetAllowedOrigins: h.setWidgetAllowedOrigins,
  rotateWidgetToken: vi.fn(),
  setWidgetLeadCaptureMode: vi.fn(),
  getWidgetAnswerSettings: vi.fn(),
  setWidgetAnswerScope: vi.fn(),
  setWidgetGuidance: vi.fn(),
}))

function form(origins: string): FormData {
  const fd = new FormData()
  fd.set('origins', origins)
  return fd
}

const action = async () => (await import('@/lib/actions/widget')).saveWidgetOriginsAction

describe('saveWidgetOriginsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireOrgAccess.mockResolvedValue({ ok: true, orgId: 5, role: 'admin' })
    h.setWidgetAllowedOrigins.mockResolvedValue(undefined)
  })

  it('saves the normalized list when every entry is usable', async () => {
    expect(await (await action())(null, form('https://Acme.test/help\nshop.acme.test'))).toEqual({
      origins: ['acme.test', 'shop.acme.test'],
    })
    expect(h.setWidgetAllowedOrigins).toHaveBeenCalledWith(5, ['acme.test', 'shop.acme.test'])
  })

  it('refuses the whole save and names the one unusable entry', async () => {
    const result = await (await action())(null, form('acme.test\ncom'))
    expect(result.origins).toBeUndefined()
    expect(result.error).toMatch(/^This entry can't be used: com\./)
    expect(result.error).toContain('such as example.com')
    expect(h.setWidgetAllowedOrigins).not.toHaveBeenCalled()
  })

  it('names every unusable entry when there are several', async () => {
    const result = await (await action())(null, form('com, acme.test, dev'))
    expect(result.error).toMatch(/^These entries can't be used: com, dev\./)
    expect(h.setWidgetAllowedOrigins).not.toHaveBeenCalled()
  })

  it('still saves an empty list, which clears the domains', async () => {
    expect(await (await action())(null, form('  '))).toEqual({ origins: [] })
    expect(h.setWidgetAllowedOrigins).toHaveBeenCalledWith(5, [])
  })

  it('requires owner or admin before reading the list', async () => {
    h.requireOrgAccess.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    expect(await (await action())(null, form('acme.test'))).toEqual({ error: 'You do not have permission to do that.' })
    expect(h.requireOrgAccess).toHaveBeenCalledWith(['owner', 'admin'])
    expect(h.setWidgetAllowedOrigins).not.toHaveBeenCalled()
  })
})
