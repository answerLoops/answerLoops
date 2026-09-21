// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TelegramIntegrationCard } from '@/components/settings/telegram'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/app/actions/integrations', () => ({
  saveTelegramIntegrationAction: vi.fn(),
  deleteTelegramIntegrationAction: vi.fn(),
}))

const REGISTERED_AT = '2026-01-02T03:04:05.000Z'

function integration(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    platform: 'telegram',
    channel_ids: ['-1001'],
    escalation_role_id: null,
    confidence_threshold: 0.8,
    auto_deflect_enabled: 0,
    enabled: 1,
    webhook_registered_at: null,
    ...overrides,
  }
}

function jsonResponse(body: unknown) {
  return Promise.resolve({ json: () => Promise.resolve(body) } as Response)
}

// Routes fetch by URL; /api/integrations returns each queued payload in turn,
// then keeps returning the last one.
function mockFetch(opts: { lists: unknown[][]; register?: unknown }) {
  const queue = [...opts.lists]
  const fn = vi.fn((url: string) => {
    if (url === '/api/telegram/register') return jsonResponse(opts.register ?? { ok: true })
    if (url === '/api/integrations') return jsonResponse(queue.length > 1 ? queue.shift() : queue[0])
    throw new Error(`unexpected fetch ${url}`)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('TelegramIntegrationCard — webhook registration state', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('shows the Register webhook prompt when no registration is recorded', async () => {
    mockFetch({ lists: [[integration()]] })
    render(<TelegramIntegrationCard />)

    expect(await screen.findByRole('button', { name: 'Register webhook' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Re-register' })).toBeNull()
    expect(screen.queryByText(/Telegram is delivering messages here/)).toBeNull()
  })

  it('shows the confirmed state and a Re-register button once a registration is recorded', async () => {
    mockFetch({ lists: [[integration({ webhook_registered_at: REGISTERED_AT })]] })
    render(<TelegramIntegrationCard />)

    expect(await screen.findByText(/Telegram is delivering messages here/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Re-register' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Register webhook' })).toBeNull()
  })

  it('flips to the confirmed state after a successful registration by refetching the integration', async () => {
    const fetchFn = mockFetch({
      lists: [[integration()], [integration({ webhook_registered_at: REGISTERED_AT })]],
      register: { ok: true, webhookUrl: 'https://app.example/api/telegram/webhook' },
    })
    render(<TelegramIntegrationCard />)

    fireEvent.click(await screen.findByRole('button', { name: 'Register webhook' }))

    expect(await screen.findByText(/Telegram is delivering messages here/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Re-register' })).toBeTruthy()
    expect(fetchFn).toHaveBeenCalledWith('/api/telegram/register', { method: 'POST' })
    // initial load + refetch after registering
    expect(fetchFn.mock.calls.filter(([u]) => u === '/api/integrations')).toHaveLength(2)
  })

  it('surfaces the error and keeps the prompt when registration fails, without refetching', async () => {
    const fetchFn = mockFetch({
      lists: [[integration()]],
      register: { ok: false, error: 'Telegram rejected the webhook' },
    })
    render(<TelegramIntegrationCard />)

    fireEvent.click(await screen.findByRole('button', { name: 'Register webhook' }))

    expect(await screen.findByText('Telegram rejected the webhook')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Register webhook' })).toBeTruthy()
    expect(screen.queryByText(/Telegram is delivering messages here/)).toBeNull()
    expect(fetchFn.mock.calls.filter(([u]) => u === '/api/integrations')).toHaveLength(1)
  })

  it('disables the button and shows Registering… while the request is in flight', async () => {
    let resolveRegister!: (v: Response) => void
    const fetchFn = vi.fn((url: string) => {
      if (url === '/api/telegram/register') {
        return new Promise<Response>((r) => { resolveRegister = r })
      }
      return jsonResponse([integration()])
    })
    vi.stubGlobal('fetch', fetchFn)
    render(<TelegramIntegrationCard />)

    fireEvent.click(await screen.findByRole('button', { name: 'Register webhook' }))

    const busy = await screen.findByRole('button', { name: 'Registering…' })
    expect((busy as HTMLButtonElement).disabled).toBe(true)

    resolveRegister({ json: () => Promise.resolve({ ok: false, error: 'nope' }) } as Response)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Registering…' })).toBeNull())
  })

  it('hides the registration banner while editing and shows the saved-token hint with an Update button', async () => {
    mockFetch({ lists: [[integration({ webhook_registered_at: REGISTERED_AT })]] })
    render(<TelegramIntegrationCard />)

    fireEvent.click(await screen.findByRole('button', { name: /Edit chats/ }))

    expect(screen.queryByText(/Telegram is delivering messages here/)).toBeNull()
    expect(screen.getByText(/A token is saved for this bot/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy()
  })

  it('shows a Connect button and no saved-token hint or registration banner when not connected', async () => {
    mockFetch({ lists: [[]] })
    render(<TelegramIntegrationCard />)

    expect(await screen.findByRole('button', { name: 'Connect' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
    expect(screen.queryByText(/A token is saved for this bot/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Register webhook' })).toBeNull()
  })
})
