// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { EmbeddedCheckoutPanel } from '@/components/billing/embedded-checkout-panel'
import { PLANS } from '@/lib/billing/plans'

vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn(() => Promise.resolve({})) }))
vi.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="stripe-provider">{children}</div>
  ),
  EmbeddedCheckout: () => <div data-testid="stripe-form" />,
}))

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const html = (status: number) =>
  new Response('<!DOCTYPE html><title>502: Bad gateway</title>', {
    status,
    headers: { 'Content-Type': 'text/html' },
  })

const plans = Object.values(PLANS)
const fetchMock = vi.fn()

function renderPanel() {
  return render(
    <EmbeddedCheckoutPanel
      plans={plans}
      initialPlanId={plans[0].id}
      initialInterval="monthly"
      publishableKey="pk_test_placeholder"
    />,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('EmbeddedCheckoutPanel — checkout session request', () => {
  it('mounts the card form once a client secret arrives', async () => {
    fetchMock.mockResolvedValue(json({ clientSecret: 'cs_secret' }))
    renderPanel()

    expect(await screen.findByTestId('stripe-form')).toBeTruthy()
  })

  it("shows the server's own error message when the API returns one", async () => {
    fetchMock.mockResolvedValue(json({ error: 'No Stripe price for this plan' }, 400))
    renderPanel()

    expect(await screen.findByText('No Stripe price for this plan')).toBeTruthy()
    expect(screen.queryByTestId('stripe-form')).toBeNull()
  })

  it('retries once when the edge returns an HTML gateway error, then mounts the form', async () => {
    fetchMock.mockResolvedValueOnce(html(502)).mockResolvedValueOnce(json({ clientSecret: 'cs_secret' }))
    renderPanel()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })

    expect(await screen.findByTestId('stripe-form')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('says checkout is temporarily unavailable, not a connection problem, when the gateway keeps failing', async () => {
    fetchMock.mockResolvedValue(html(502))
    renderPanel()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })

    expect(await screen.findByText(/temporarily unavailable/i)).toBeTruthy()
    expect(screen.queryByText(/check your connection/i)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-gateway response with no usable body', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))
    renderPanel()

    expect(await screen.findByText(/unexpected response/i)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the connection message for a genuine network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    renderPanel()

    expect(await screen.findByText(/check your connection/i)).toBeTruthy()
  })
})
