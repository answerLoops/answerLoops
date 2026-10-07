// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const actions = vi.hoisted(() => ({ submitProductFeedbackAction: vi.fn() }))
vi.mock('@/lib/actions/product-feedback', () => actions)

import { FeedbackComposer } from '@/components/feedback/feedback-composer'

const GOOD = 'The new dashboard is great and saves our team a lot of time.'
const MIN = 35

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

function setup() {
  const view = render(<FeedbackComposer />)
  return {
    ...view,
    textarea: screen.getByPlaceholderText(/leave answerloops some feedback/i) as HTMLTextAreaElement,
    submit: screen.getByRole('button', { name: /submit|sending/i }) as HTMLButtonElement,
    anon: screen.getByLabelText(/post anonymously/i) as HTMLInputElement,
  }
}
const type = (el: HTMLTextAreaElement, value: string) => fireEvent.change(el, { target: { value } })
// The counter is a coloured span: red when unusable, green when submittable.
const counter = (text: string) => screen.getByText(text)

describe('counter', () => {
  it('starts at 0/500 in the invalid colour with the rules visible', () => {
    setup()
    expect(counter('0/500').className).toMatch(/rose/)
    expect(screen.getByText(/minimum 35\. No links\./)).toBeTruthy()
  })

  it('stays invalid below the minimum and turns valid exactly at 35 characters', () => {
    const { textarea, submit } = setup()
    type(textarea, 'a'.repeat(MIN - 1))
    expect(counter('34/500').className).toMatch(/rose/)
    expect(submit.disabled).toBe(true)

    type(textarea, 'a'.repeat(MIN))
    expect(counter('35/500').className).toMatch(/emerald/)
    expect(submit.disabled).toBe(false)
  })

  it('caps the textarea at 500 characters and 500 is still valid', () => {
    const { textarea, submit } = setup()
    expect(textarea.maxLength).toBe(500)
    type(textarea, 'a'.repeat(500))
    expect(counter('500/500').className).toMatch(/emerald/)
    expect(submit.disabled).toBe(false)
  })

  it('counts trimmed length: whitespace-only input is 0 usable characters', () => {
    const { textarea, submit } = setup()
    type(textarea, ' '.repeat(60))
    expect(counter('0/500').className).toMatch(/rose/)
    expect(submit.disabled).toBe(true)
  })

  it('does not let surrounding whitespace pad a short message over the minimum', () => {
    const { textarea, submit } = setup()
    type(textarea, `   ${'a'.repeat(10)}${' '.repeat(40)}`)
    expect(counter('10/500')).toBeTruthy()
    expect(submit.disabled).toBe(true)
  })

  it('turns the counter invalid again when a link makes an otherwise long message unacceptable', () => {
    const { textarea, submit } = setup()
    type(textarea, GOOD)
    expect(counter(`${GOOD.length}/500`).className).toMatch(/emerald/)
    type(textarea, `${GOOD} www.example.com`)
    expect(screen.getByText(/\/500$/).className).toMatch(/rose/)
    expect(submit.disabled).toBe(true)
  })
})

describe('submission guard', () => {
  it.each([
    ['too short', 'too short'],
    ['a scheme link', `${GOOD} https://spam.example`],
    ['a bare-domain link', `${GOOD} visit spam.com now`],
    ['whitespace only', ' '.repeat(80)],
  ])('does not call the action when the draft is invalid (%s), even via form submit', (_n, value) => {
    const { textarea, container } = setup()
    type(textarea, value)
    fireEvent.submit(container.querySelector('form')!)
    expect(actions.submitProductFeedbackAction).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('submits through the form submit event when valid', async () => {
    actions.submitProductFeedbackAction.mockResolvedValue({ ok: true })
    const { textarea, container } = setup()
    type(textarea, GOOD)
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    expect(actions.submitProductFeedbackAction).toHaveBeenCalledTimes(1)
  })

  it('passes the body as typed (untrimmed; the server trims) and anonymous=false by default', async () => {
    actions.submitProductFeedbackAction.mockResolvedValue({ ok: true })
    const { textarea, submit } = setup()
    const raw = `  ${GOOD}\n\nSecond paragraph.  `
    type(textarea, raw)
    fireEvent.click(submit)
    await waitFor(() => expect(actions.submitProductFeedbackAction).toHaveBeenCalled())
    expect(actions.submitProductFeedbackAction).toHaveBeenCalledWith({ body: raw, anonymous: false })
  })

  it('passes anonymous=true when the box is checked', async () => {
    actions.submitProductFeedbackAction.mockResolvedValue({ ok: true })
    const { textarea, submit, anon } = setup()
    fireEvent.click(anon)
    expect(anon.checked).toBe(true)
    type(textarea, GOOD)
    fireEvent.click(submit)
    await waitFor(() => expect(actions.submitProductFeedbackAction).toHaveBeenCalled())
    expect(actions.submitProductFeedbackAction).toHaveBeenCalledWith({ body: GOOD, anonymous: true })
  })
})

describe('pending state', () => {
  it('disables Submit and shows "Sending…" until the action resolves, and blocks double submit', async () => {
    let resolve!: (v: { ok: true }) => void
    actions.submitProductFeedbackAction.mockReturnValue(new Promise((r) => (resolve = r)))
    const { textarea, submit, container } = setup()
    type(textarea, GOOD)
    fireEvent.click(submit)

    await waitFor(() => expect(screen.getByRole('button', { name: /sending/i })).toBeTruthy())
    expect((screen.getByRole('button', { name: /sending/i }) as HTMLButtonElement).disabled).toBe(true)
    // A second submit while in flight must be ignored.
    fireEvent.submit(container.querySelector('form')!)
    expect(actions.submitProductFeedbackAction).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).toBeNull()

    resolve({ ok: true })
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    await waitFor(() => expect(screen.queryByRole('button', { name: /sending/i })).toBeNull())
    expect(screen.getByRole('button', { name: /^submit$/i })).toBeTruthy()
  })
})

describe('result handling', () => {
  it('clears the textarea on success, keeps the anonymous choice, and shows the awaiting-review status', async () => {
    actions.submitProductFeedbackAction.mockResolvedValue({ ok: true })
    const { textarea, submit, anon } = setup()
    fireEvent.click(anon)
    type(textarea, GOOD)
    fireEvent.click(submit)

    const status = await screen.findByRole('status')
    expect(status.textContent).toMatch(/awaiting review/i)
    expect(textarea.value).toBe('')
    expect(counter('0/500')).toBeTruthy()
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /^submit$/i }) as HTMLButtonElement).disabled).toBe(true),
    )
    // The checkbox is a preference, not part of the draft.
    expect(anon.checked).toBe(true)
  })

  it('hides the success message as soon as the user types again', async () => {
    actions.submitProductFeedbackAction.mockResolvedValue({ ok: true })
    const { textarea, submit } = setup()
    type(textarea, GOOD)
    fireEvent.click(submit)
    await screen.findByRole('status')
    type(textarea, 'n')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows the action error in an alert, keeps the draft, and shows no success status', async () => {
    actions.submitProductFeedbackAction.mockResolvedValue({ ok: false, error: 'Please try again later.' })
    const { textarea, submit } = setup()
    type(textarea, GOOD)
    fireEvent.click(submit)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Please try again later.')
    expect(textarea.value).toBe(GOOD)
    expect(screen.queryByRole('status')).toBeNull()
    // Draft is retained and re-submittable once the transition settles.
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /^submit$/i }) as HTMLButtonElement).disabled).toBe(false),
    )
  })

  it('clears a previous error when the user retries and it succeeds', async () => {
    actions.submitProductFeedbackAction
      .mockResolvedValueOnce({ ok: false, error: 'Rate limited.' })
      .mockResolvedValueOnce({ ok: true })
    const { textarea, submit } = setup()
    type(textarea, GOOD)
    fireEvent.click(submit)
    await screen.findByRole('alert')

    fireEvent.click(await screen.findByRole('button', { name: /^submit$/i }))
    await screen.findByRole('status')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(actions.submitProductFeedbackAction).toHaveBeenCalledTimes(2)
  })
})
