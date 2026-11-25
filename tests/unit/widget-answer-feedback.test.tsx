// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnswerFeedback } from '@/app/widget/[widgetToken]/answer-feedback'

/**
 * The thumbs under one widget answer (app/widget/[widgetToken]/answer-feedback.tsx).
 * A thumbs-down saves the flag at once and then opens a panel for a reason, a
 * note and an optional email; a thumbs-up is a single quiet click. Every request
 * carries only the signed tokens, never the answer text.
 */

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
vi.stubGlobal('fetch', fetchMock)

const WIDGET = 'a'.repeat(48)
const config = { widgetToken: WIDGET, renderToken: 'render-token', offerEmail: true }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function bodies(method: string) {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === method)
    .map(([, init]) => JSON.parse(init!.body as string))
}

function mountFeedback(over: Partial<typeof config> = {}) {
  return render(<AnswerFeedback config={{ ...config, ...over }} answerToken="answer-token-1" />)
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (_url, init) =>
    init?.method === 'POST' ? json({ ok: true, flagToken: 'flag-token-1' }) : json({ ok: true })
  )
})

describe('AnswerFeedback: the thumbs', () => {
  it('offers two labelled buttons and nothing else at first', () => {
    mountFeedback()
    expect(screen.getByRole('button', { name: /this answer helped/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /wrong or did not help/i })).toBeTruthy()
    expect(screen.queryByTestId('answer-feedback-panel')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a thumbs-up is one request, with only the signed token, and a short thank-you', async () => {
    mountFeedback()
    await userEvent.setup().click(screen.getByTestId('feedback-up'))
    expect(await screen.findByTestId('answer-feedback-thanks')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/widget/flag')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init!.body as string)).toEqual({
      widgetToken: WIDGET,
      renderToken: 'render-token',
      verdict: 'up',
      answerToken: 'answer-token-1',
    })
    expect(screen.queryByTestId('answer-feedback-panel')).toBeNull()
  })

  it('a thumbs-down saves the flag straight away, before anything else is asked', async () => {
    mountFeedback()
    await userEvent.setup().click(screen.getByTestId('feedback-down'))
    expect(await screen.findByTestId('answer-feedback-panel')).toBeTruthy()
    expect(bodies('POST')).toEqual([
      { widgetToken: WIDGET, renderToken: 'render-token', verdict: 'down', answerToken: 'answer-token-1' },
    ])
    expect(bodies('PATCH')).toEqual([])
  })

  it('sends only one request however many times the thumb is pressed while it is in flight', async () => {
    let release: (r: Response) => void = () => {}
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (release = resolve)))
    mountFeedback()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('feedback-down'))
    await user.click(screen.getByTestId('feedback-down'))
    await user.click(screen.getByTestId('feedback-up'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    release(json({ ok: true, flagToken: 'f' }))
    expect(await screen.findByTestId('answer-feedback-panel')).toBeTruthy()
  })
})

describe('AnswerFeedback: the panel', () => {
  async function openPanel(over: Partial<typeof config> = {}) {
    mountFeedback(over)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('feedback-down'))
    await screen.findByTestId('answer-feedback-panel')
    return user
  }

  it('asks for an email only when the owner allows email follow-up', async () => {
    await openPanel()
    expect(screen.getByLabelText(/leave your email/i)).toBeTruthy()
  })

  it('never shows an email field when email follow-up is off', async () => {
    await openPanel({ offerEmail: false })
    expect(screen.queryByLabelText(/leave your email/i)).toBeNull()
    expect(screen.queryByPlaceholderText('you@example.com')).toBeNull()
  })

  it('sends the chosen reason, the note and the email with the flag token, then thanks the visitor', async () => {
    const user = await openPanel()
    await user.click(screen.getByRole('button', { name: 'Out of date' }))
    await user.type(screen.getByLabelText(/anything else/i), 'The price changed in May')
    await user.type(screen.getByLabelText(/leave your email/i), 'visitor@example.com')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByTestId('answer-feedback-thanks')).toBeTruthy()
    expect(bodies('PATCH')).toEqual([
      {
        widgetToken: WIDGET,
        renderToken: 'render-token',
        flagToken: 'flag-token-1',
        reason: 'outdated',
        note: 'The price changed in May',
        email: 'visitor@example.com',
      },
    ])
  })

  it('shows which reason is chosen, lets the visitor change it, and leaves it out when unchosen', async () => {
    const user = await openPanel()
    const wrong = screen.getByRole('button', { name: 'Wrong information' })
    await user.click(wrong)
    expect(wrong.getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Something else' }))
    expect(wrong.getAttribute('aria-pressed')).toBe('false')
    await user.click(screen.getByRole('button', { name: 'Something else' }))
    await user.type(screen.getByLabelText(/anything else/i), 'just a note')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByTestId('answer-feedback-thanks')
    expect(bodies('PATCH')[0]).not.toHaveProperty('reason')
    expect(bodies('PATCH')[0]).toHaveProperty('note', 'just a note')
  })

  it('sends nothing more when the visitor adds nothing, since the flag is already saved', async () => {
    const user = await openPanel()
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByTestId('answer-feedback-thanks')).toBeTruthy()
    expect(bodies('PATCH')).toEqual([])
  })

  it('"Not now" closes the panel without a second request, and the flag stays', async () => {
    const user = await openPanel()
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(await screen.findByTestId('answer-feedback-thanks')).toBeTruthy()
    expect(screen.queryByTestId('answer-feedback-panel')).toBeNull()
    expect(bodies('PATCH')).toEqual([])
    expect(bodies('POST')).toHaveLength(1)
  })

  it('tells the visitor when the server refuses the email and keeps what they typed', async () => {
    const user = await openPanel()
    fetchMock.mockImplementation(async () => new Response('Invalid email', { status: 400 }))
    await user.type(screen.getByLabelText(/anything else/i), 'a note')
    // Passes the browser's own email check, but not the server's stricter one.
    await user.type(screen.getByLabelText(/leave your email/i), 'a@b')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/email address doesn.t look right/i)
    expect((screen.getByLabelText(/anything else/i) as HTMLTextAreaElement).value).toBe('a note')
    expect(screen.getByTestId('answer-feedback-panel')).toBeTruthy()
  })

  it('shows a short retry message on a failed send, keeps the panel, and succeeds on the next try', async () => {
    const user = await openPanel()
    fetchMock.mockImplementationOnce(async () => new Response('x', { status: 500 }))
    await user.click(screen.getByRole('button', { name: 'Wrong information' }))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/try again/i)
    expect(screen.getByTestId('answer-feedback-panel')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByTestId('answer-feedback-thanks')).toBeTruthy()
  })

  it('the note is capped so a long paste cannot be sent', async () => {
    await openPanel()
    expect((screen.getByLabelText(/anything else/i) as HTMLTextAreaElement).maxLength).toBe(500)
  })
})

describe('AnswerFeedback: failures', () => {
  it.each([403, 404])('disappears quietly on a %i, since there is nothing the visitor can do', async (status) => {
    fetchMock.mockImplementation(async () => new Response('no', { status }))
    const { container } = mountFeedback()
    await userEvent.setup().click(screen.getByTestId('feedback-down'))
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('shows a retry message on a server error and leaves the thumbs to try again', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('x', { status: 500 }))
    mountFeedback()
    const user = await userEvent.setup()
    await user.click(screen.getByTestId('feedback-down'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/try again/i)
    expect(screen.getByTestId('feedback-down')).toBeTruthy()
    await user.click(screen.getByTestId('feedback-down'))
    expect(await screen.findByTestId('answer-feedback-panel')).toBeTruthy()
  })

  it('shows a retry message when the network fails', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch')
    })
    mountFeedback()
    await userEvent.setup().click(screen.getByTestId('feedback-up'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/try again/i)
  })

  it('still counts the thumbs-down when its flag token did not come back, without offering details it cannot send', async () => {
    fetchMock.mockImplementation(async () => json({ ok: true }))
    mountFeedback()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('feedback-down'))
    await screen.findByTestId('answer-feedback-panel')
    await user.click(screen.getByRole('button', { name: 'Wrong information' }))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByTestId('answer-feedback-thanks')).toBeTruthy()
    expect(bodies('PATCH')).toEqual([])
  })
})
