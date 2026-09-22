// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MockEventSource, defineVisibility } from './mock-event-source'
import { render, screen, act, waitFor } from '@testing-library/react'

/**
 * `TeamSection` (Settings → Team) is the second half of issue #127.
 *
 * It used to construct its own `EventSource('/api/events/stream')`, so a
 * Settings tab held TWO streams — `DashboardLive` (mounted by the dashboard
 * layout on every route) plus this one — and each stream costs a dedicated,
 * non-pooled Postgres LISTEN connection on the server. It now subscribes
 * through `lib/live-events` instead, so the tab holds exactly one.
 *
 * What these tests pin, all of it observable behaviour rather than internals:
 *
 *  - Mount fetches `/api/team/members` + `/api/team/invites` and renders them.
 *  - `member_joined` on the shared stream refetches BOTH endpoints and the new
 *    member shows up. That is the whole feature.
 *  - `resync` also refetches. This is the subtle one: the shared stream is
 *    closed entirely while the tab is hidden, so a `member_joined` fired in
 *    that window is lost forever. `members`/`invites` are client `useState`
 *    that a `router.refresh()` cannot repopulate, so without the `resync`
 *    handler the list would silently show stale data after refocus.
 *  - Unmount unsubscribes: no refetch afterwards, even while the shared stream
 *    stays open for other islands.
 *  - TeamSection opens NO EventSource of its own. Mounted alone, or alongside
 *    DashboardLive, the tab has exactly one. A regression here reintroduces
 *    the second Postgres connection this branch removed.
 *
 * `lib/live-events` keeps its subscriber set and stream at module scope, so
 * every test re-imports the module graph fresh via `vi.resetModules()` and a
 * dynamic import, and unmounts everything it renders.
 */

const { routerRefresh } = vi.hoisted(() => ({ routerRefresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: routerRefresh }),
}))

vi.mock('@/app/actions/api-keys', () => ({
  createApiKeyAction: vi.fn(),
  revokeApiKeyAction: vi.fn(),
}))
vi.mock('@/app/actions/sla', () => ({ updateSLAAction: vi.fn() }))
vi.mock('@/app/actions/notion', () => ({
  saveNotionConnectionAction: vi.fn(),
  deleteNotionConnectionAction: vi.fn(),
}))
vi.mock('@/app/actions/integrations', () => ({
  saveDiscordIntegrationAction: vi.fn(),
  deleteDiscordIntegrationAction: vi.fn(),
  saveDiscordGuildChannelsAction: vi.fn(),
  removeDiscordGuildAction: vi.fn(),
  updateDiscordAutoDeflectAction: vi.fn(),
  saveSlackChannelsAction: vi.fn(),
  deleteSlackIntegrationAction: vi.fn(),
  saveTelegramIntegrationAction: vi.fn(),
  deleteTelegramIntegrationAction: vi.fn(),
  saveDiscourseIntegrationAction: vi.fn(),
  deleteDiscourseIntegrationAction: vi.fn(),
  saveCircleIntegrationAction: vi.fn(),
  deleteCircleIntegrationAction: vi.fn(),
  saveEmailIntegrationAction: vi.fn(),
  deleteEmailIntegrationAction: vi.fn(),
  startEmailDomainVerificationAction: vi.fn(),
  checkEmailDomainVerificationAction: vi.fn(),
  removeEmailDomainAction: vi.fn(),
  disconnectOauthAction: vi.fn(),
  generateGoogleChatConnectCodeAction: vi.fn(),
  saveGoogleChatSettingsAction: vi.fn(),
  deleteGoogleChatIntegrationAction: vi.fn(),
  getCurrentDeploymentMode: vi.fn(async () => 'cloud'),
}))
vi.mock('@/app/actions/invitations', () => ({
  sendInviteAction: vi.fn(),
  revokeInviteAction: vi.fn(),
  removeMemberAction: vi.fn(),
  transferOwnershipAction: vi.fn(),
}))
vi.mock('@/app/actions/widget', () => ({
  getWidgetTokenAction: vi.fn(),
  regenerateWidgetTokenAction: vi.fn(),
  saveWidgetOriginsAction: vi.fn(),
}))
vi.mock('@/app/actions/ai-config', () => ({
  saveAIConfigAction: vi.fn(),
  clearAIConfigAction: vi.fn(),
}))
vi.mock('@/app/actions/roi', () => ({ saveROIConfigAction: vi.fn() }))
vi.mock('@/app/actions/account', () => ({
  deleteAccountAction: vi.fn(),
  getCurrentOrgName: vi.fn(async () => null),
}))

// --- the shared stream, mocked -------------------------------------------
// happy-dom has no EventSource. Same mock shape as tests/unit/live-events.test.ts
// and tests/unit/dashboard-live.test.tsx; instances are tracked so we can assert
// how many streams a mount opened.




async function fireVisibilityChange(hidden: boolean) {
  defineVisibility(hidden)
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

async function emitLive(type: string, source = MockEventSource.last) {
  await act(async () => {
    source.emit(type)
  })
}

// --- the API, mocked ------------------------------------------------------

type MemberRow = {
  membership_id: number
  user_id: number
  role: string
  joined_at: string
  email: string | null
  name: string | null
}

type InviteRow = {
  id: number
  email: string
  role: string
  expires_at: string
  token: string
}

const OWNER: MemberRow = {
  membership_id: 1,
  user_id: 1,
  role: 'owner',
  joined_at: '2026-01-01T00:00:00.000Z',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
}

const NEW_MEMBER: MemberRow = {
  membership_id: 2,
  user_id: 2,
  role: 'member',
  joined_at: '2026-02-01T00:00:00.000Z',
  email: 'grace@example.com',
  name: 'Grace Hopper',
}

const PENDING_INVITE: InviteRow = {
  id: 10,
  email: 'grace@example.com',
  role: 'member',
  expires_at: '2026-12-31T00:00:00.000Z',
  token: 'tok_grace',
}

/** What the API returns right now; tests reassign these to simulate a change. */
let membersPayload: MemberRow[] = []
let invitesPayload: InviteRow[] = []

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : String(input)
  if (url === '/api/auth/session') return jsonResponse({ user: { id: 1 } })
  if (url === '/api/team/members') return jsonResponse(membersPayload)
  if (url === '/api/team/invites') return jsonResponse(invitesPayload)
  throw new Error(`unexpected fetch in test: ${url}`)
})

function callsTo(url: string) {
  return fetchMock.mock.calls.filter(([input]) => String(input) === url).length
}

// --- module graph, re-imported per test -----------------------------------

let TeamSection: typeof import('@/app/(dashboard)/settings/page').TeamSection
let DashboardLive: typeof import('@/components/dashboard/dashboard-live').DashboardLive

beforeEach(async () => {
  vi.clearAllMocks()
  MockEventSource.reset()
  defineVisibility(false)
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource)
  vi.stubGlobal('fetch', fetchMock)

  membersPayload = [OWNER]
  invitesPayload = [PENDING_INVITE]

  vi.resetModules()
  ;({ TeamSection } = await import('@/app/(dashboard)/settings/page'))
  ;({ DashboardLive } = await import('@/components/dashboard/dashboard-live'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Render TeamSection and wait for the initial member/invite load to land. */
async function renderTeamSection() {
  const view = render(<TeamSection />)
  await screen.findByText('Ada Lovelace')
  return view
}

describe('TeamSection — initial load', () => {
  it('fetches members and invites on mount and renders both', async () => {
    const { unmount } = await renderTeamSection()

    expect(callsTo('/api/team/members')).toBe(1)
    expect(callsTo('/api/team/invites')).toBe(1)

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText(/ada@example\.com/)).toBeInTheDocument()

    // The pending invite renders its own row under "Pending Invites".
    expect(screen.getByText('Pending Invites')).toBeInTheDocument()
    expect(screen.getByText('grace@example.com')).toBeInTheDocument()

    unmount()
  })

  it('renders an empty members list without crashing when the API returns nothing', async () => {
    membersPayload = []
    invitesPayload = []

    const { unmount } = render(<TeamSection />)

    expect(await screen.findByText('No members yet.')).toBeInTheDocument()
    expect(screen.queryByText('Pending Invites')).not.toBeInTheDocument()

    unmount()
  })
})

describe('TeamSection — member_joined on the shared stream', () => {
  it('refetches both endpoints and renders the newly joined member', async () => {
    const { unmount } = await renderTeamSection()
    expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument()

    // Grace accepted her invite: she is a member now and the invite is gone.
    membersPayload = [OWNER, NEW_MEMBER]
    invitesPayload = []

    await emitLive('member_joined')

    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('Pending Invites')).not.toBeInTheDocument()
    })

    expect(callsTo('/api/team/members')).toBe(2)
    expect(callsTo('/api/team/invites')).toBe(2)

    unmount()
  })

  it('ignores data_changed, which is not one of its events', async () => {
    const { unmount } = await renderTeamSection()

    await emitLive('data_changed')

    expect(callsTo('/api/team/members')).toBe(1)
    expect(callsTo('/api/team/invites')).toBe(1)

    unmount()
  })
})

describe('TeamSection — resync after the stream was down', () => {
  it('refetches on refocus, picking up a member_joined that fired while the tab was hidden', async () => {
    const { unmount } = await renderTeamSection()
    const first = MockEventSource.last

    // Hidden tab: lib/live-events closes the stream, so the server-side
    // member_joined that follows is never delivered to anyone.
    await fireVisibilityChange(true)
    expect(first.closed).toBe(true)

    membersPayload = [OWNER, NEW_MEMBER]
    invitesPayload = []

    // Nothing has changed on screen — the event was lost, not received.
    expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument()
    expect(callsTo('/api/team/members')).toBe(1)

    // Refocus rebuilds the stream, which emits `resync`.
    await fireVisibilityChange(false)

    // Without the resync handler this list would silently stay stale:
    // members/invites are useState, so a router.refresh() cannot repopulate them.
    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument()
    expect(callsTo('/api/team/members')).toBe(2)
    expect(callsTo('/api/team/invites')).toBe(2)

    unmount()
  })
})

describe('TeamSection — unsubscribes on unmount', () => {
  it('does not refetch after unmount even while the shared stream stays open', async () => {
    // DashboardLive holds the shared stream open past TeamSection's unmount,
    // so this tests TeamSection's own unsubscribe rather than the module's
    // last-subscriber teardown.
    const live = render(<DashboardLive />)
    const { unmount } = await renderTeamSection()

    const before = fetchMock.mock.calls.length
    unmount()

    membersPayload = [OWNER, NEW_MEMBER]
    await emitLive('member_joined')
    await fireVisibilityChange(true)
    await fireVisibilityChange(false)

    expect(fetchMock.mock.calls.length).toBe(before)

    live.unmount()
  })
})

describe('TeamSection — one connection per tab (issue #127)', () => {
  it('opens no EventSource of its own: one shared stream to /api/events/stream', async () => {
    const { unmount } = await renderTeamSection()

    expect(MockEventSource.openCount).toBe(1)
    expect(MockEventSource.last.url).toBe('/api/events/stream')

    unmount()
    expect(MockEventSource.last.closed).toBe(true)
  })

  it('adds no second stream when mounted alongside DashboardLive', async () => {
    // The dashboard layout mounts DashboardLive on every route, so this is
    // exactly what a real Settings tab looks like. Two streams here means two
    // Postgres LISTEN connections — the regression this branch fixed.
    const live = render(<DashboardLive />)
    expect(MockEventSource.openCount).toBe(1)
    const shared = MockEventSource.last

    const { unmount } = await renderTeamSection()

    expect(MockEventSource.openCount).toBe(1)
    expect(MockEventSource.last).toBe(shared)
    expect(shared.closed).toBe(false)

    // And it is genuinely subscribed to that one stream, not silently inert.
    membersPayload = [OWNER, NEW_MEMBER]
    await emitLive('member_joined', shared)
    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument()

    unmount()
    live.unmount()
  })
})
