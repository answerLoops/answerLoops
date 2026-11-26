import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The widget panel page (app/widget/[widgetToken]/page.tsx) on this instance's
 * own host. A page there is allowed without being listed only for the widgets
 * mayOpenOnOwnHost permits; any other widget is decided on its listed domains
 * alone. The owner's preview mode (isSelfPreview) follows the own-host rule,
 * and the render limits come from lib/widget/usage-limits.ts.
 */

const h = vi.hoisted(() => ({
  getOrgByWidgetToken: vi.fn(),
  rateLimitShared: vi.fn(),
  mayOpenOnOwnHost: vi.fn(),
  headers: new Map<string, string>(),
}))

vi.mock('next/headers', () => ({ headers: async () => ({ get: (k: string) => h.headers.get(k.toLowerCase()) ?? null }) }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('@/lib/db/queries/widgets', () => ({ getOrgByWidgetToken: h.getOrgByWidgetToken }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: vi.fn(async () => false) }))
vi.mock('@/lib/db/queries/widget-logos', () => ({ getWidgetLogoVersion: vi.fn(async () => null) }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/widget/own-host-embed', () => ({ mayOpenOnOwnHost: h.mayOpenOnOwnHost }))
vi.mock('@/app/widget/[widgetToken]/widget-chat', () => ({ WidgetChat: () => null }))
vi.mock('@/app/widget/[widgetToken]/embed-refused', () => ({ EmbedRefused: () => null }))

const TOKEN = 'f6'.repeat(24)
const SELF = 'app.test'

function orgWith(allowed: string | null) {
  return {
    id: 7,
    name: 'Acme',
    widget_token: TOKEN,
    widget_slug: null,
    widget_allowed_origins: allowed,
    widget_lead_capture_mode: 'on-failure',
    widget_answer_scope: 'general',
    widget_guidance: null,
    widget_daily_answer_limit: null,
    widget_appearance: { title: null, welcome: null, brandColor: null, starterQuestions: [], starterEnabled: true },
  }
}

async function renderPage() {
  vi.stubEnv('AUTH_SECRET', '<test-render-token-secret>')
  const { default: WidgetPage } = await import('@/app/widget/[widgetToken]/page')
  const element = (await WidgetPage({ params: Promise.resolve({ widgetToken: TOKEN }) })) as {
    props: Record<string, unknown>
  }
  return element.props
}

/** The refusal screen gets a reason; the chat gets a render token. */
const refused = (props: Record<string, unknown>) => 'reason' in props && !('renderToken' in props)

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  for (const name of ['WIDGET_LIMIT_LOADS_PER_ADDRESS_PER_MINUTE', 'WIDGET_LIMIT_LOADS_PER_WIDGET_PER_MINUTE']) {
    vi.stubEnv(name, '')
  }
  h.headers.clear()
  h.headers.set('referer', `https://${SELF}/settings`)
  h.headers.set('host', SELF)
  h.rateLimitShared.mockResolvedValue({ ok: true })
  h.mayOpenOnOwnHost.mockResolvedValue(false)
  h.getOrgByWidgetToken.mockResolvedValue(orgWith(null))
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('widget page on this instance\'s own host', () => {
  it('refuses a widget that may not open here and lists no domains', async () => {
    const props = await renderPage()
    expect(h.mayOpenOnOwnHost).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), TOKEN)
    expect(refused(props)).toBe(true)
    expect(props.reason).toBe('not-configured')
    expect(props.origin).toBe(SELF)
    // Refused before a render is counted or a token is minted.
    expect(h.rateLimitShared).not.toHaveBeenCalled()
  })

  it('refuses a widget that may not open here when its domains do not include this host', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(orgWith('acme.test'))
    const props = await renderPage()
    expect(refused(props)).toBe(true)
    expect(props.reason).toBe('origin-not-allowed')
  })

  it('still allows a widget that lists this host among its domains, but not as a preview', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(orgWith(`acme.test\n${SELF}`))
    const props = await renderPage()
    expect(refused(props)).toBe(false)
    expect(props.renderToken).toEqual(expect.any(String))
    expect(props.isSelfPreview).toBe(false)
  })

  it('allows a widget that may open here, as the owner preview', async () => {
    h.mayOpenOnOwnHost.mockResolvedValue(true)
    const props = await renderPage()
    expect(refused(props)).toBe(false)
    expect(props.isSelfPreview).toBe(true)
  })

  it('does not ask about the own host for a page on a listed customer domain', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(orgWith('acme.test'))
    h.headers.set('referer', 'https://acme.test/help')
    const props = await renderPage()
    expect(h.mayOpenOnOwnHost).not.toHaveBeenCalled()
    expect(refused(props)).toBe(false)
    expect(props.isSelfPreview).toBe(false)
  })

  it('refuses an unlisted customer domain without asking about the own host', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(orgWith('acme.test'))
    h.headers.set('referer', 'https://elsewhere.test/')
    const props = await renderPage()
    expect(h.mayOpenOnOwnHost).not.toHaveBeenCalled()
    expect(props.reason).toBe('origin-not-allowed')
  })
})

describe('widget page render limits', () => {
  it('uses the default per-address and per-widget limits', async () => {
    h.mayOpenOnOwnHost.mockResolvedValue(true)
    await renderPage()
    expect(h.rateLimitShared).toHaveBeenCalledWith('widget-render-ip:203.0.113.9', 30, 60_000)
    expect(h.rateLimitShared).toHaveBeenCalledWith(`widget-render-token:${TOKEN}`, 600, 60_000)
  })

  it('uses the limits this instance configured', async () => {
    h.mayOpenOnOwnHost.mockResolvedValue(true)
    vi.stubEnv('WIDGET_LIMIT_LOADS_PER_ADDRESS_PER_MINUTE', '45')
    vi.stubEnv('WIDGET_LIMIT_LOADS_PER_WIDGET_PER_MINUTE', '900')
    await renderPage()
    expect(h.rateLimitShared).toHaveBeenCalledWith('widget-render-ip:203.0.113.9', 45, 60_000)
    expect(h.rateLimitShared).toHaveBeenCalledWith(`widget-render-token:${TOKEN}`, 900, 60_000)
  })
})
