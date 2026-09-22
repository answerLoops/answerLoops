// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmailIntegrationCard } from '@/components/settings/email'
import { saveEmailIntegrationAction } from '@/lib/actions/integrations'

const { routerRefresh, mockSearchParams } = vi.hoisted(() => ({
  routerRefresh: vi.fn(),
  mockSearchParams: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: vi.fn(), refresh: routerRefresh }),
}))

vi.mock('@/lib/actions/api-keys', () => ({
  createApiKeyAction: vi.fn(),
  revokeApiKeyAction: vi.fn(),
}))
vi.mock('@/lib/actions/sla', () => ({ updateSLAAction: vi.fn() }))
vi.mock('@/lib/actions/notion', () => ({ saveNotionConnectionAction: vi.fn(), deleteNotionConnectionAction: vi.fn() }))
vi.mock('@/lib/actions/integrations', () => ({
  saveDiscordIntegrationAction: vi.fn(),
  deleteDiscordIntegrationAction: vi.fn(),
  saveDiscordGuildChannelsAction: vi.fn(),
  removeDiscordGuildAction: vi.fn(),
  saveSlackChannelsAction: vi.fn(),
  deleteSlackIntegrationAction: vi.fn(),
  saveTelegramIntegrationAction: vi.fn(),
  deleteTelegramIntegrationAction: vi.fn(),
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
vi.mock('@/lib/actions/invitations', () => ({
  sendInviteAction: vi.fn(),
  revokeInviteAction: vi.fn(),
  removeMemberAction: vi.fn(),
  transferOwnershipAction: vi.fn(),
}))
vi.mock('@/lib/actions/widget', () => ({
  getWidgetTokenAction: vi.fn(),
  regenerateWidgetTokenAction: vi.fn(),
}))
vi.mock('@/lib/actions/ai-config', () => ({
  saveAIConfigAction: vi.fn(),
  clearAIConfigAction: vi.fn(),
}))
vi.mock('@/lib/actions/roi', () => ({ saveROIConfigAction: vi.fn() }))
vi.mock('@/lib/actions/account', () => ({
  deleteAccountAction: vi.fn(),
  getCurrentOrgName: vi.fn(async () => null),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function connectedIntegration() {
  return {
    id: 1,
    platform: 'email',
    bot_token: null,
    channel_ids: [],
    escalation_role_id: null,
    confidence_threshold: 0.8,
    auto_deflect_enabled: 0,
    enabled: 1,
    email_send_method: 'platform',
  }
}

const verifiedDomain = {
  id: 1,
  domain: 'acme.com',
  dkim_record_name: 'resend._domainkey.acme.com',
  dkim_record_value: 'p=abc123',
  return_path_record_name: 'send.acme.com',
  return_path_record_value: 'v=spf1 include:resend.net ~all',
  dmarc_suggestion: null,
  status: 'verified' as const,
}

const connectedMailbox = {
  id: 1,
  mailbox_address: 'support@gmail.com',
  provider: 'gmail' as const,
  status: 'connected' as const,
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body }
}

// Every endpoint the card reads has to be routed explicitly. /api/email-oauth
// in particular: falling through to the integrations array returns a truthy
// value, which the card reads as "a mailbox is already connected" and skips
// the chooser — silently turning a chooser test into a configured-state test.
function mockRoutes(opts: { integrations?: unknown[]; emailDomain?: unknown; oauth?: unknown } = {}) {
  mockFetch.mockImplementation((url: string) => {
    if (url === '/api/email-domain') return Promise.resolve(jsonResponse(opts.emailDomain ?? null))
    if (url === '/api/email-oauth') return Promise.resolve(jsonResponse(opts.oauth ?? null))
    return Promise.resolve(jsonResponse(opts.integrations ?? [connectedIntegration()]))
  })
}

/** The two supported customer-facing delivery choices. */
const OWN_DOMAIN_CARD = /^use your own domain/i
const MAILBOX_CARD = /^connect a mailbox/i
const DIFFERENT_METHOD = /use a different method/i

/** The domain form's only distinguishing control. */
const DOMAIN_INPUT = 'yourcompany.com'

function chooserIsShowing() {
  return (
    screen.queryByRole('button', { name: OWN_DOMAIN_CARD }) !== null &&
    screen.queryByRole('button', { name: MAILBOX_CARD }) !== null &&
    screen.queryByRole('button', { name: OWN_DOMAIN_CARD }) !== null &&
    screen.queryByRole('button', { name: MAILBOX_CARD }) !== null
  )
}

/**
 * The email card used to render the custom-domain panel, the Gmail/Outlook
 * OAuth panel and a raw webhook block all at once, the moment the channel was
 * enabled — mutually exclusive ways to receive mail, stacked, with
 * nothing indicating that only one was needed or which to prefer. The fix asks
 * the question once and then shows exactly one answer's UI.
 *
 * These tests pin the gate itself: that no setup UI appears before a method is
 * picked, that picking one shows that one and hides the others, and that the
 * way back to the chooser actually tears the abandoned method's UI down. If a
 * future change re-mounts a section unconditionally, the "and only one"
 * assertions here fail rather than the screen quietly regressing to the stack.
 */
describe('EmailDeliverySection: the delivery-method chooser gates setup UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams.forEach((_v, k) => mockSearchParams.delete(k))
  })

  it('offers the two supported methods and no setup UI when the channel is on but nothing is configured', async () => {
    mockRoutes()
    render(<EmailIntegrationCard />)

    await waitFor(() => expect(screen.getByRole('button', { name: OWN_DOMAIN_CARD })).toBeTruthy())
    expect(screen.getByRole('button', { name: MAILBOX_CARD })).toBeTruthy()

    // Nothing from either setup panel may be on screen before a choice.
    expect(screen.queryByPlaceholderText(DOMAIN_INPUT)).toBeNull()
    expect(screen.queryByRole('button', { name: /connect gmail/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /connect outlook/i })).toBeNull()
  })

  it('shows the mailbox setup and not the domain form after choosing "Connect a mailbox"', async () => {
    mockRoutes()
    render(<EmailIntegrationCard />)

    fireEvent.click(await screen.findByRole('button', { name: MAILBOX_CARD }))

    await waitFor(() => expect(screen.getByRole('button', { name: /connect gmail/i })).toBeTruthy())
    expect(screen.getByRole('button', { name: /connect outlook/i })).toBeTruthy()
    expect(screen.queryByPlaceholderText(DOMAIN_INPUT)).toBeNull()
    // The chooser itself is replaced, not appended to.
    expect(screen.queryByRole('button', { name: /forward from your provider/i })).toBeNull()
  })

  it('shows the domain form and not the mailbox setup after choosing "Use your own domain"', async () => {
    mockRoutes()
    render(<EmailIntegrationCard />)

    fireEvent.click(await screen.findByRole('button', { name: OWN_DOMAIN_CARD }))

    await waitFor(() => expect(screen.getByPlaceholderText(DOMAIN_INPUT)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /connect gmail/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /connect outlook/i })).toBeNull()
    expect(screen.queryByRole('button', { name: MAILBOX_CARD })).toBeNull()
  })

  it('returns to the chooser and tears down the abandoned method when "Use a different method" is clicked', async () => {
    mockRoutes()
    const user = userEvent.setup()
    render(<EmailIntegrationCard />)

    fireEvent.click(await screen.findByRole('button', { name: MAILBOX_CARD }))
    await waitFor(() => expect(screen.getByRole('button', { name: /connect gmail/i })).toBeTruthy())

    await user.click(screen.getByRole('button', { name: DIFFERENT_METHOD }))

    await waitFor(() => expect(screen.getByRole('button', { name: OWN_DOMAIN_CARD })).toBeTruthy())
    expect(chooserIsShowing()).toBe(true)
    // The half-finished mailbox setup must be gone, not merely scrolled past.
    expect(screen.queryByRole('button', { name: /connect gmail/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /connect outlook/i })).toBeNull()
    expect(screen.queryByRole('button', { name: DIFFERENT_METHOD })).toBeNull()
  })

  it('lets a second choice replace the first, so the chooser is not a one-way door', async () => {
    mockRoutes()
    const user = userEvent.setup()
    render(<EmailIntegrationCard />)

    fireEvent.click(await screen.findByRole('button', { name: OWN_DOMAIN_CARD }))
    await waitFor(() => expect(screen.getByPlaceholderText(DOMAIN_INPUT)).toBeTruthy())

    await user.click(screen.getByRole('button', { name: DIFFERENT_METHOD }))
    fireEvent.click(await screen.findByRole('button', { name: MAILBOX_CARD }))

    await waitFor(() => expect(screen.getByRole('button', { name: /connect gmail/i })).toBeTruthy())
    expect(screen.queryByPlaceholderText(DOMAIN_INPUT)).toBeNull()
  })
})

/**
 * Which method is in use is derived from what is actually configured, not from
 * stored UI state — a verified domain or a live mailbox *is* the answer to
 * "which method". So an org that already finished setup must never be shown
 * the question again: the chooser would put a live integration one stray click
 * away from a screen that looks like it was never set up.
 *
 * The "Use a different method" button is deliberately absent in that state as
 * well. Each configured section owns its own removal flow (Remove domain,
 * Disconnect), and hiding the section behind a method switch would strand the
 * only way to undo the configuration — which is why the conditional exists and
 * why it is asserted here rather than left as an implementation detail.
 */
describe('EmailDeliverySection: an already-configured method skips the chooser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams.forEach((_v, k) => mockSearchParams.delete(k))
  })

  it('renders the domain section straight away when a domain is verified', async () => {
    mockRoutes({ emailDomain: verifiedDomain })
    render(<EmailIntegrationCard />)

    await waitFor(() => expect(screen.getByRole('button', { name: /remove domain/i })).toBeTruthy())
    expect(screen.getByText('acme.com')).toBeTruthy()

    expect(screen.queryByRole('button', { name: MAILBOX_CARD })).toBeNull()
    expect(screen.queryByRole('button', { name: /forward from your provider/i })).toBeNull()
    expect(screen.queryByText(/how should mail reach/i)).toBeNull()
    expect(screen.queryByRole('button', { name: DIFFERENT_METHOD })).toBeNull()
  })

  it('renders the mailbox section straight away when a mailbox is connected', async () => {
    mockRoutes({ oauth: connectedMailbox })
    render(<EmailIntegrationCard />)

    await waitFor(() => expect(screen.getByText('support@gmail.com')).toBeTruthy())

    expect(screen.queryByRole('button', { name: OWN_DOMAIN_CARD })).toBeNull()
    expect(screen.queryByRole('button', { name: /forward from your provider/i })).toBeNull()
    expect(screen.queryByPlaceholderText(DOMAIN_INPUT)).toBeNull()
    expect(screen.queryByText(/how should mail reach/i)).toBeNull()
    expect(screen.queryByRole('button', { name: DIFFERENT_METHOD })).toBeNull()
  })
})

/**
 * The badge read "Active" the moment an email integration row existed, with no
 * domain verified and no mailbox connected — a green light on a channel that
 * could not receive a single message. Enabling the channel and being able to
 * take delivery are different questions, and the badge was answering the first
 * while appearing to answer the second.
 *
 * Three states now, driven by what is provably configured rather than by the
 * enabled flag alone. The amber middle state is the whole point of the change:
 * it is the only thing that tells someone their setup is unfinished, so a
 * regression that collapses it back into "Active" has to fail a test.
 */
describe('EmailIntegrationCard: status badge reflects deliverability, not just the enabled flag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams.forEach((_v, k) => mockSearchParams.delete(k))
  })

  it('reads Inactive / Not connected when the channel is off', async () => {
    mockRoutes({ integrations: [] })
    render(<EmailIntegrationCard />)

    await waitFor(() => expect(screen.getByText('Inactive')).toBeTruthy())
    expect(screen.getByText('Not connected')).toBeTruthy()
    expect(screen.queryByText('Active')).toBeNull()
  })

  it('reads Needs setup / Setup incomplete when the channel is on but no method is configured', async () => {
    mockRoutes()
    render(<EmailIntegrationCard />)

    await waitFor(() => expect(screen.getByText('Needs setup')).toBeTruthy())
    expect(screen.getByText('Setup incomplete')).toBeTruthy()
    // The regression: this used to say Active with nothing able to deliver.
    expect(screen.queryByText('Active')).toBeNull()
    expect(screen.queryByText('Connected')).toBeNull()
  })

  it('reads Active / Connected once a domain is verified', async () => {
    mockRoutes({ emailDomain: verifiedDomain })
    render(<EmailIntegrationCard />)

    await waitFor(() => expect(screen.getByText('Active')).toBeTruthy())
    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.queryByText('Needs setup')).toBeNull()
    expect(screen.queryByText('Setup incomplete')).toBeNull()
  })

  it('reads Active / Connected once a mailbox is connected', async () => {
    mockRoutes({ oauth: connectedMailbox })
    render(<EmailIntegrationCard />)

    await waitFor(() => expect(screen.getByText('Active')).toBeTruthy())
    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.queryByText('Needs setup')).toBeNull()
  })
})

/**
 * Getting in used to mean filling three optional fields — allowed senders,
 * escalation address, confidence threshold — plus a deflection toggle, then
 * pressing a button labelled "Connect" that connected nothing: it wrote a row
 * and left the actual delivery setup for afterwards. Every one of those fields
 * is meaningless until mail has somewhere to arrive from.
 *
 * Turning the channel on is now one button with an empty form, and the tuning
 * fields live in the "Edit sender filters & deflections" editor that already
 * existed for them. These tests assert the fields are genuinely absent on the
 * way in, not merely collapsed, so re-adding one to the pre-connect path is
 * caught.
 */
describe('EmailIntegrationCard: pre-connect is a single action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams.forEach((_v, k) => mockSearchParams.delete(k))
  })

  it('shows only a "Set up email" button, with none of the optional tuning fields', async () => {
    mockRoutes({ integrations: [] })
    render(<EmailIntegrationCard />)

    await waitFor(() => expect(screen.getByRole('button', { name: /set up email/i })).toBeTruthy())

    expect(screen.queryByPlaceholderText('example.com, partner@other.com')).toBeNull()
    expect(screen.queryByPlaceholderText('team@yourcompany.com')).toBeNull()
    expect(screen.queryByText(/allowed sender addresses/i)).toBeNull()
    expect(screen.queryByText(/escalation email/i)).toBeNull()
    expect(screen.queryByText(/confidence threshold/i)).toBeNull()
    expect(screen.queryByText('Automatic Deflections')).toBeNull()
    // And the old label that promised more than it did.
    expect(screen.queryByRole('button', { name: /^connect$/i })).toBeNull()
  })

  it('submits the empty form to saveEmailIntegrationAction when "Set up email" is pressed', async () => {
    mockRoutes({ integrations: [] })
    const user = userEvent.setup()
    render(<EmailIntegrationCard />)

    await user.click(await screen.findByRole('button', { name: /set up email/i }))

    await waitFor(() => expect(saveEmailIntegrationAction).toHaveBeenCalled())
  })

  it('reveals the tuning fields only through the editor, once connected', async () => {
    mockRoutes()
    const user = userEvent.setup()
    render(<EmailIntegrationCard />)

    const editButton = await screen.findByRole('button', { name: /edit sender filters/i })
    expect(screen.queryByPlaceholderText('example.com, partner@other.com')).toBeNull()

    await user.click(editButton)

    // Each of these is one of the absences asserted above, so finding them
    // here proves those assertions are testing something real.
    await waitFor(() => expect(screen.getByPlaceholderText('example.com, partner@other.com')).toBeTruthy())
    expect(screen.getByPlaceholderText('team@yourcompany.com')).toBeTruthy()
    expect(screen.getByText(/allowed sender addresses/i)).toBeTruthy()
    expect(screen.getByText(/escalation email/i)).toBeTruthy()
    expect(screen.getByText(/confidence threshold/i)).toBeTruthy()
    expect(screen.getByText('Automatic Deflections')).toBeTruthy()
  })
})
