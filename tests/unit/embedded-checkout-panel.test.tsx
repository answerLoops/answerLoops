// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
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

function renderPanel(promoCode?: string) {
  return render(
    <EmbeddedCheckoutPanel
      plans={plans}
      initialPlanId={plans[0].id}
      initialInterval="monthly"
      promoCode={promoCode}
      publishableKey="pk_test_placeholder"
    />,
  )
}

const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string)

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

describe('EmbeddedCheckoutPanel — promo code field', () => {
  it('hides the input behind a link and sends no code until one is applied', async () => {
    fetchMock.mockResolvedValue(json({ clientSecret: 'cs_secret', promoStatus: 'none' }))
    renderPanel()
    await screen.findByTestId('stripe-form')

    expect(screen.queryByLabelText('Promo code')).toBeNull()
    expect(lastBody()).not.toHaveProperty('promoCode')

    fireEvent.click(screen.getByRole('button', { name: 'Have a promo code?' }))
    expect(screen.getByLabelText('Promo code')).toBeTruthy()
  })

  it('requests a new session carrying the code when Apply is pressed, and says no card is needed', async () => {
    fetchMock.mockResolvedValueOnce(json({ clientSecret: 'cs_one', promoStatus: 'none' }))
    renderPanel()
    await screen.findByTestId('stripe-form')

    fireEvent.click(screen.getByRole('button', { name: 'Have a promo code?' }))
    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: 'FREEACCESS' } })
    // Typing alone must not fire a request.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockResolvedValueOnce(json({ clientSecret: 'cs_two', promoStatus: 'no_card' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(await screen.findByText('Code applied. No card is needed.')).toBeTruthy()
    expect(lastBody()).toMatchObject({ promoCode: 'FREEACCESS' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('confirms a partial discount without claiming the card is skipped', async () => {
    fetchMock.mockResolvedValueOnce(json({ clientSecret: 'cs_one', promoStatus: 'none' }))
    renderPanel()
    await screen.findByTestId('stripe-form')

    fireEvent.click(screen.getByRole('button', { name: 'Have a promo code?' }))
    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: 'HALFOFF' } })
    fetchMock.mockResolvedValueOnce(json({ clientSecret: 'cs_two', promoStatus: 'applied' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(await screen.findByText('Code applied.')).toBeTruthy()
    expect(screen.queryByText(/no card/i)).toBeNull()
  })

  it('shows an invalid code in red and keeps the card form mounted', async () => {
    fetchMock.mockResolvedValueOnce(json({ clientSecret: 'cs_one', promoStatus: 'none' }))
    renderPanel()
    await screen.findByTestId('stripe-form')

    fireEvent.click(screen.getByRole('button', { name: 'Have a promo code?' }))
    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: 'NOPE' } })
    fetchMock.mockResolvedValueOnce(json({ clientSecret: 'cs_two', promoStatus: 'invalid' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    const message = await screen.findByText('That code is not valid.')
    expect(message.className).toContain('text-red')
    expect(await screen.findByTestId('stripe-form')).toBeTruthy()
  })

  it('clears the code when the box is emptied and applied', async () => {
    fetchMock.mockResolvedValue(json({ clientSecret: 'cs', promoStatus: 'applied' }))
    renderPanel('HALFOFF')
    await screen.findByText('Code applied.')
    expect(lastBody()).toMatchObject({ promoCode: 'HALFOFF' })

    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: '' } })
    fetchMock.mockResolvedValue(json({ clientSecret: 'cs2', promoStatus: 'none' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(lastBody()).not.toHaveProperty('promoCode'))
    expect(screen.queryByText('Code applied.')).toBeNull()
  })

  it('opens the field already filled in, and applied, when the code came from the link', async () => {
    fetchMock.mockResolvedValue(json({ clientSecret: 'cs', promoStatus: 'no_card' }))
    renderPanel('FREEACCESS')

    expect((screen.getByLabelText('Promo code') as HTMLInputElement).value).toBe('FREEACCESS')
    expect(await screen.findByText('Code applied. No card is needed.')).toBeTruthy()
    expect(lastBody()).toMatchObject({ promoCode: 'FREEACCESS' })
  })

  it('changes the "charged today?" answer only when the code removes the card', async () => {
    fetchMock.mockResolvedValue(json({ clientSecret: 'cs', promoStatus: 'no_card' }))
    renderPanel('FREEACCESS')
    await screen.findByText('Code applied. No card is needed.')

    expect(screen.getByText(/no card is needed\. If the discount ever ends/i)).toBeTruthy()
  })
})
