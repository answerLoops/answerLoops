// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BillingPage from '@/app/(dashboard)/billing/page'

const DAY = 24 * 60 * 60 * 1000

interface Status {
  planId: string
  status: string
  isTrialing: boolean
  isAppTrial: boolean
  trialEndsAt: string | null
  used: number
  limit: number | null
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
}

function status(over: Partial<Status> = {}): Status {
  return {
    planId: 'standard',
    status: 'active',
    isTrialing: false,
    isAppTrial: false,
    trialEndsAt: null,
    used: 10,
    limit: 500,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    ...over,
  }
}

function inDays(days: number) {
  // Offset by a few minutes so Math.ceil lands on the intended day count.
  return new Date(Date.now() + days * DAY - 5 * 60 * 1000).toISOString()
}

function json(body: unknown) {
  return Promise.resolve({ json: () => Promise.resolve(body) })
}

let fetchMock: ReturnType<typeof vi.fn>
const originalLocation = window.location

function mockFetch(data: Status, checkoutBody: unknown = { url: 'https://checkout.example/session' }) {
  fetchMock = vi.fn((input: string) => {
    if (input === '/api/billing/status') return json(data)
    if (input === '/api/billing/checkout') return json(checkoutBody)
    if (input === '/api/billing/portal') return json({ url: 'https://portal.example' })
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
}

async function renderPage(data: Status) {
  mockFetch(data)
  render(<BillingPage />)
  await waitFor(() => expect(screen.queryByText(/Loading billing info/)).toBeNull())
}

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: 'http://localhost/billing' },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: originalLocation })
})

describe('billing page app trial banner', () => {
  it('says no card is on file and nothing will be charged', async () => {
    await renderPage(status({ status: 'trialing', isTrialing: true, isAppTrial: true, trialEndsAt: inDays(5) }))
    expect(screen.getByText(/No card is on file and nothing will be charged/)).toBeTruthy()
    expect(screen.queryByText(/card will be charged/i)).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/api/billing/status')
  })

  it('shows plural days left for several days', async () => {
    await renderPage(status({ status: 'trialing', isTrialing: true, isAppTrial: true, trialEndsAt: inDays(5) }))
    expect(screen.getByText('5 days left in your trial')).toBeTruthy()
  })

  it('uses singular for one day left', async () => {
    await renderPage(status({ status: 'trialing', isTrialing: true, isAppTrial: true, trialEndsAt: inDays(1) }))
    expect(screen.getByText('1 day left in your trial')).toBeTruthy()
  })

  it('says the trial ends today at zero days', async () => {
    await renderPage(status({ status: 'trialing', isTrialing: true, isAppTrial: true, trialEndsAt: new Date(Date.now() - 1000).toISOString() }))
    expect(screen.getByText('Your trial ends today')).toBeTruthy()
  })
})

describe('billing page Stripe trial banner', () => {
  it('says the card will be charged when the trial ends', async () => {
    await renderPage(status({ status: 'trialing', isTrialing: true, isAppTrial: false, trialEndsAt: inDays(4) }))
    expect(screen.getByText(/Your card will be charged when the trial ends/)).toBeTruthy()
    expect(screen.queryByText(/No card is on file/)).toBeNull()
  })
})

describe('billing page plan cards', () => {
  it('labels upgrade buttons "Subscribe to" for an app trial and marks the current card as an active trial', async () => {
    await renderPage(status({ status: 'trialing', isTrialing: true, isAppTrial: true, trialEndsAt: inDays(5) }))
    expect(screen.getByRole('button', { name: 'Subscribe to Pro' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Subscribe to Enterprise' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Upgrade to/ })).toBeNull()
    expect(screen.getByText('Active trial')).toBeTruthy()
  })

  it('labels upgrade buttons "Upgrade to" when not an app trial', async () => {
    await renderPage(status({ status: 'active' }))
    expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Subscribe to/ })).toBeNull()
    expect(screen.getByText('Your current plan')).toBeTruthy()
    expect(screen.queryByText('Active trial')).toBeNull()
  })

  it('shows Active trial and "Upgrade to" buttons for a Stripe trial', async () => {
    await renderPage(status({ status: 'trialing', isTrialing: true, isAppTrial: false, trialEndsAt: inDays(4) }))
    expect(screen.getByText('Active trial')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toBeTruthy()
  })

  it('states every new account starts with a 14-day free trial, no card needed', async () => {
    await renderPage(status())
    expect(screen.getByText('Every new account starts with a 14-day free trial, no card needed')).toBeTruthy()
  })
})

describe('billing page manage subscription block', () => {
  it('is hidden for an app trial', async () => {
    await renderPage(status({ status: 'trialing', isTrialing: true, isAppTrial: true, trialEndsAt: inDays(5) }))
    expect(screen.queryByText(/Manage subscription/)).toBeNull()
    expect(screen.queryByText('Subscription management')).toBeNull()
  })

  it('is shown for a paid active plan', async () => {
    await renderPage(status({ status: 'active' }))
    expect(screen.getByRole('button', { name: /Manage subscription/ })).toBeTruthy()
  })

  it('is shown for a Stripe trial', async () => {
    await renderPage(status({ status: 'trialing', isTrialing: true, isAppTrial: false, trialEndsAt: inDays(4) }))
    expect(screen.getByRole('button', { name: /Manage subscription/ })).toBeTruthy()
  })

  it('is hidden once the trial has expired', async () => {
    await renderPage(status({ status: 'trial_expired', isAppTrial: true }))
    expect(screen.queryByText(/Manage subscription/)).toBeNull()
  })
})

describe.each(['trial_expired', 'canceled'])('billing page with status %s', (s) => {
  it('shows the ended panel telling the user to add a card, with no current plan marked', async () => {
    await renderPage(status({ status: s, isAppTrial: s === 'trial_expired' }))
    expect(screen.getByText('Your trial has ended')).toBeTruthy()
    expect(screen.getByText(/add a card/i)).toBeTruthy()
    expect(screen.queryByText('Your current plan')).toBeNull()
    expect(screen.queryByText('Active trial')).toBeNull()
    expect(screen.queryByText('Usage this month')).toBeNull()
  })
})

describe('billing page checkout click', () => {
  it('POSTs the plan id to checkout and redirects to the returned url', async () => {
    const user = userEvent.setup()
    await renderPage(status({ status: 'trialing', isTrialing: true, isAppTrial: true, trialEndsAt: inDays(5) }))
    await user.click(screen.getByRole('button', { name: 'Subscribe to Pro' }))
    await waitFor(() => expect(window.location.href).toBe('https://checkout.example/session'))
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/billing/checkout')!
    expect(call[1].method).toBe('POST')
    expect(JSON.parse(call[1].body)).toEqual({ planId: 'pro' })
  })

  it('shows the error and does not redirect when checkout fails', async () => {
    const user = userEvent.setup()
    mockFetch(status({ status: 'trial_expired', isAppTrial: true }), { error: 'Checkout unavailable' })
    render(<BillingPage />)
    await waitFor(() => expect(screen.getByText('Your trial has ended')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: 'Subscribe to Enterprise' }))
    await waitFor(() => expect(screen.getByText('Checkout unavailable')).toBeTruthy())
    expect(window.location.href).toBe('http://localhost/billing')
  })
})
