import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The widget panel page (app/widget/[widgetToken]/page.tsx) decides whether a
 * visitor can flag an answer: only on a plan with the Review queue (where flags
 * are read), and never in the owner's own preview of their widget.
 */

const h = vi.hoisted(() => ({
  getOrgByWidgetToken: vi.fn(),
  orgHasFeature: vi.fn(),
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
vi.mock('@/lib/db/queries/widget-logos', () => ({ getWidgetLogoVersion: vi.fn(async () => null) }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: h.rateLimitShared }))
vi.mock('@/lib/http/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/app/widget/[widgetToken]/widget-chat', () => ({ WidgetChat: () => null }))
vi.mock('@/app/widget/[widgetToken]/embed-refused', () => ({ EmbedRefused: () => null }))

const TOKEN = 'a1'.repeat(24)

const org = {
  id: 7,
  name: 'Acme',
  widget_token: TOKEN,
  widget_allowed_origins: 'acme.test, app.test',
  widget_lead_capture_mode: 'on-failure',
  widget_answer_scope: 'general',
  widget_guidance: null,
  widget_appearance: { title: null, welcome: null, brandColor: null, starterQuestions: [], starterEnabled: true },
}

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
  h.getOrgByWidgetToken.mockResolvedValue(org)
})

describe('widget page: answer flagging', () => {
  it('turns it on for a visitor on the customer\'s site when the plan has the Review queue', async () => {
    const props = await renderPage()
    expect(h.orgHasFeature).toHaveBeenCalledWith(7, 'kb_review_queue')
    expect(props.answerFlagsEnabled).toBe(true)
  })

  it('leaves it off on a plan without the Review queue', async () => {
    h.orgHasFeature.mockImplementation(async (_id: number, feature: string) => feature !== 'kb_review_queue')
    expect((await renderPage()).answerFlagsEnabled).toBe(false)
  })

  it('leaves it off in the owner\'s own preview, without even checking the plan', async () => {
    h.headers.set('referer', 'https://app.test/settings')
    const props = await renderPage()
    expect(props.answerFlagsEnabled).toBe(false)
    expect(h.orgHasFeature).not.toHaveBeenCalledWith(7, 'kb_review_queue')
  })
})
