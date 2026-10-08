// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WidgetBrandingUpsell } from '@/components/billing/widget-branding-upsell'

function mockFetch(handler: (url: string) => unknown) {
  const fn = vi.fn(async (url: string) => ({ json: async () => handler(url) }))
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  delete process.env.DEPLOYMENT_MODE
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WidgetBrandingUpsell', () => {
  it('shows the Pro upgrade message to a Standard org', async () => {
    mockFetch(() => ({ planId: 'standard' }))
    render(<WidgetBrandingUpsell />)
    expect(await screen.findByText(/available on Pro and above/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Upgrade to Pro/i })).toBeTruthy()
  })

  it('starts checkout for the Pro plan when the button is pressed', async () => {
    const fetchFn = mockFetch((url) => (url === '/api/billing/status' ? { planId: 'standard' } : { error: 'stop' }))
    render(<WidgetBrandingUpsell />)
    await userEvent.click(await screen.findByRole('button', { name: /Upgrade to Pro/i }))
    await waitFor(() => {
      const checkout = fetchFn.mock.calls.find((c) => c[0] === '/api/billing/checkout')
      expect(checkout).toBeTruthy()
      expect(JSON.parse((checkout as unknown as [string, { body: string }])[1].body)).toEqual({ planId: 'pro' })
    })
  })

  it.each(['pro', 'enterprise', 'self-hosted'])('renders nothing for %s', async (planId) => {
    const fetchFn = mockFetch(() => ({ planId }))
    const { container } = render(<WidgetBrandingUpsell />)
    await waitFor(() => expect(fetchFn).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(container.textContent).toBe('')
  })

  it('renders nothing while the plan is unknown or the lookup fails', async () => {
    const fn = vi.fn(async () => {
      throw new Error('offline')
    })
    vi.stubGlobal('fetch', fn)
    const { container } = render(<WidgetBrandingUpsell />)
    await waitFor(() => expect(fn).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})
