import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The widget panel page (app/widget/[widgetToken]/page.tsx): the owner's title,
 * welcome message and brand color are applied only on a plan that includes
 * customization, and what reaches the panel is generated, never raw input.
 */

const h = vi.hoisted(() => ({
  getOrgByWidgetToken: vi.fn(),
  orgHasFeature: vi.fn(),
  getWidgetLogoVersion: vi.fn(),
  rateLimitShared: vi.fn(),
  headers: new Map<string, string>(),
}))

vi.mock('next/headers', () => ({ headers: async () => ({ get: (k: string) => h.headers.get(k.toLowerCase()) ?? null }) }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('@/lib/db/queries/widgets', () => ({ getOrgByWidgetToken: h.getOrgByWidgetToken }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.orgHasFeature }))
vi.mock('@/lib/db/queries/widget-logos', () => ({
  getWidgetLogoVersion: h.getWidgetLogoVersion,
  getWidgetLogo: vi.fn(async () => null),
  setWidgetLogo: vi.fn(async () => ({ etag: '0123456789abcdef' })),
  deleteWidgetLogo: vi.fn(async () => undefined),
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/app/widget/[widgetToken]/widget-chat', () => ({ WidgetChat: () => null }))
vi.mock('@/app/widget/[widgetToken]/embed-refused', () => ({ EmbedRefused: () => null }))

const TOKEN = 'a1'.repeat(24)

const org = (appearance: {
  title: string | null
  welcome: string | null
  brandColor: string | null
  starterQuestions?: string[]
  starterEnabled?: boolean
}) => ({
  id: 7,
  name: 'Acme',
  widget_token: TOKEN,
  plan_id: 'pro',
  widget_allowed_origins: 'acme.test',
  widget_lead_capture_mode: 'off',
  widget_answer_scope: 'general',
  widget_guidance: null,
  widget_appearance: { starterQuestions: [], starterEnabled: true, ...appearance },
})

async function renderPage() {
  process.env.AUTH_SECRET = 'test-secret-for-render-token-derivation'
  const { default: WidgetPage } = await import('@/app/widget/[widgetToken]/page')
  const element = (await WidgetPage({ params: Promise.resolve({ widgetToken: TOKEN }) })) as {
    props: Record<string, unknown>
  }
  return element.props
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  h.headers.clear()
  h.headers.set('referer', 'https://acme.test/help')
  h.headers.set('host', 'app.test')
  h.rateLimitShared.mockResolvedValue({ ok: true })
  h.orgHasFeature.mockResolvedValue(true)
  h.getWidgetLogoVersion.mockResolvedValue(null)
})

describe('widget page appearance', () => {
  it('passes the owner’s title, welcome message and brand palette to the panel on a customization plan', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(org({ title: 'Acme Help Desk', welcome: 'Hello!', brandColor: '#ffd60a' }))
    const props = await renderPage()
    expect(h.orgHasFeature).toHaveBeenCalledWith(7, 'white_label_widget')
    expect(props.title).toBe('Acme Help Desk')
    expect(props.welcome).toBe('Hello!')
    const style = props.brandStyle as Record<string, string>
    expect(style['--brand-600']).toBe('#ffd60a')
    expect(style['--brand-on']).toBe('#111827')
    expect(props.showBranding).toBe(false)
  })

  it('passes the starter questions to the panel on a customization plan', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(
      org({ title: null, welcome: null, brandColor: null, starterQuestions: ['How does it work?', 'What does it cost?'] })
    )
    const props = await renderPage()
    expect(props.starterQuestions).toEqual(['How does it work?', 'What does it cost?'])
  })

  it('passes none when the owner has switched them off, though the questions stay saved', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(
      org({ title: null, welcome: null, brandColor: null, starterQuestions: ['How does it work?'], starterEnabled: false })
    )
    expect((await renderPage()).starterQuestions).toEqual([])
  })

  it('shows no starter questions on a plan without customization, whatever is stored', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    h.getOrgByWidgetToken.mockResolvedValue(
      org({ title: null, welcome: null, brandColor: null, starterQuestions: ['How does it work?'] })
    )
    expect((await renderPage()).starterQuestions).toEqual([])
  })

  it('applies none of it on a plan without customization, whatever is stored', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    h.getOrgByWidgetToken.mockResolvedValue(org({ title: 'Acme Help Desk', welcome: 'Hello!', brandColor: '#ffd60a' }))
    const props = await renderPage()
    expect(props.title).toBeNull()
    expect(props.welcome).toBeNull()
    expect(props.brandStyle).toBeNull()
    expect(props.showBranding).toBe(true)
  })

  it('leaves the default look when the owner has chosen nothing', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(org({ title: null, welcome: null, brandColor: null }))
    const props = await renderPage()
    expect(props.title).toBeNull()
    expect(props.welcome).toBeNull()
    expect(props.brandStyle).toBeNull()
  })

  it('only ever hands the panel generated #rrggbb tokens', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(org({ title: null, welcome: null, brandColor: '#0b1f4d' }))
    const style = (await renderPage()).brandStyle as Record<string, string>
    for (const [name, value] of Object.entries(style)) {
      expect(name).toMatch(/^--brand-(50|100|200|300|400|500|600|700|800|900|950|on)$/)
      expect(value).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})


describe('widget page logo', () => {
  it('passes the workspace logo\'s address to the panel on a customization plan', async () => {
    h.getWidgetLogoVersion.mockResolvedValue({ etag: '0123456789abcdef' })
    h.getOrgByWidgetToken.mockResolvedValue(org({ title: null, welcome: null, brandColor: null }))
    const props = await renderPage()
    expect(h.getWidgetLogoVersion).toHaveBeenCalledWith(7)
    expect(props.logoUrl).toBe(`/api/widget/logo/${TOKEN}?v=0123456789abcdef`)
  })

  it('passes none when the workspace has no logo', async () => {
    h.getOrgByWidgetToken.mockResolvedValue(org({ title: null, welcome: null, brandColor: null }))
    expect((await renderPage()).logoUrl).toBeNull()
  })

  it('passes none on a plan without customization, whatever is stored, and does not look it up', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    h.getWidgetLogoVersion.mockResolvedValue({ etag: '0123456789abcdef' })
    h.getOrgByWidgetToken.mockResolvedValue(org({ title: null, welcome: null, brandColor: null }))
    expect((await renderPage()).logoUrl).toBeNull()
    expect(h.getWidgetLogoVersion).not.toHaveBeenCalled()
  })
})
