// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewsletterForm } from '@/components/marketing/newsletter-form'

function mockJsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, email = 'reader@example.com') {
  await user.type(screen.getByLabelText('Email address'), email)
  await user.click(screen.getByRole('button', { name: 'Subscribe' }))
}

describe('NewsletterForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('submits the typed email as JSON and shows the success message on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<NewsletterForm />)

    await fillAndSubmit(user, 'reader@example.com')

    expect(
      await screen.findByRole('status')
    ).toHaveTextContent("You're on the list — new posts land in your inbox.")

    expect(fetchMock).toHaveBeenCalledWith('/api/newsletter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reader@example.com' }),
    })
    // Success replaces the form entirely.
    expect(screen.queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument()
  })

  it('shows the same success UI when the email was already subscribed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockJsonResponse(200, { ok: true, already: true }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<NewsletterForm />)

    await fillAndSubmit(user)

    expect(
      await screen.findByRole('status')
    ).toHaveTextContent("You're on the list — new posts land in your inbox.")
  })

  it('disables the input and button and shows "Subscribing…" while the request is in flight', async () => {
    let resolveFetch!: (value: Response) => void
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<NewsletterForm />)

    await user.type(screen.getByLabelText('Email address'), 'reader@example.com')
    await user.click(screen.getByRole('button', { name: 'Subscribe' }))

    const pendingButton = await screen.findByRole('button', { name: 'Subscribing…' })
    expect(pendingButton).toBeDisabled()
    expect(screen.getByLabelText('Email address')).toBeDisabled()

    resolveFetch(mockJsonResponse(200, { ok: true }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
  })

  it('shows a generic error message and keeps the form visible on a 400 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(400, { ok: false }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<NewsletterForm />)

    await fillAndSubmit(user, 'not-an-email')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "That email address didn't look right. Double-check it and try again."
    )
    // Form stays visible, still shows the idle label, and the input keeps the typed value.
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toHaveValue('not-an-email')
  })

  it('shows the rate-limit-specific message on a 429 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(429, { ok: false }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<NewsletterForm />)

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You're doing that a bit fast. Try again in a minute."
    )
  })

  it('shows a network-failure message when fetch itself throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<NewsletterForm />)

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Try again in a moment.'
    )
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeInTheDocument()
  })
})
