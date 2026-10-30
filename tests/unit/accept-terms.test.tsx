// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ acceptTerms: vi.fn() }))
vi.mock('@/lib/actions/terms', () => ({ acceptTerms: h.acceptTerms }))

import { AcceptTermsForm } from '@/components/auth/accept-terms-form'

const button = () => screen.getByRole('button', { name: /start my free trial|continue|one moment/i }) as HTMLButtonElement

beforeEach(() => {
  h.acceptTerms.mockReset().mockResolvedValue(undefined)
})

describe('AcceptTermsForm', () => {
  it('starts with both boxes unchecked and the button held until the terms are accepted', async () => {
    const user = userEvent.setup()
    render(<AcceptTermsForm startsTrial />)
    const terms = screen.getByRole('checkbox', { name: /terms of service/i }) as HTMLInputElement
    const marketing = screen.getByRole('checkbox', { name: /product updates/i }) as HTMLInputElement
    expect(terms.checked).toBe(false)
    expect(marketing.checked).toBe(false)
    expect(button().disabled).toBe(true)
    await user.click(terms)
    expect(button().disabled).toBe(false)
  })

  it('product updates alone does not release the button', async () => {
    const user = userEvent.setup()
    render(<AcceptTermsForm startsTrial />)
    await user.click(screen.getByRole('checkbox', { name: /product updates/i }))
    expect(button().disabled).toBe(true)
  })

  it('submits both answers and where to go next', async () => {
    const user = userEvent.setup()
    render(<AcceptTermsForm startsTrial callbackUrl="/invite/abc" />)
    await user.click(screen.getByRole('checkbox', { name: /terms of service/i }))
    await user.click(screen.getByRole('checkbox', { name: /product updates/i }))
    await user.click(button())
    await waitFor(() =>
      expect(h.acceptTerms).toHaveBeenCalledWith({ terms: true, marketing: true, callbackUrl: '/invite/abc' }),
    )
  })

  it('sends marketing as false when only the terms were accepted', async () => {
    const user = userEvent.setup()
    render(<AcceptTermsForm startsTrial />)
    await user.click(screen.getByRole('checkbox', { name: /terms of service/i }))
    await user.click(button())
    await waitFor(() => expect(h.acceptTerms).toHaveBeenCalledWith(expect.objectContaining({ terms: true, marketing: false })))
  })

  it('shows the server refusal instead of failing silently', async () => {
    h.acceptTerms.mockResolvedValue({ error: 'Please accept the Terms of Service and Privacy Policy to continue.' })
    const user = userEvent.setup()
    render(<AcceptTermsForm startsTrial />)
    await user.click(screen.getByRole('checkbox', { name: /terms of service/i }))
    await user.click(button())
    expect((await screen.findByRole('alert')).textContent).toMatch(/please accept/i)
  })

  it('names the trial on the button when one starts, and not when it does not', () => {
    const { unmount } = render(<AcceptTermsForm startsTrial />)
    expect(screen.getByRole('button', { name: 'Start my free trial' })).toBeTruthy()
    unmount()
    render(<AcceptTermsForm startsTrial={false} />)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })
})
