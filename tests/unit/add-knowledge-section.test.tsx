// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The dashboard's "Write an answer by hand" form: what it lets a person
 * submit, that a failure keeps their text, and that success clears the form and
 * tells the page to reload its article list. The server action is faked.
 */

const h = vi.hoisted(() => ({ addKnowledgeAction: vi.fn() }))
vi.mock('@/lib/actions/kb', () => ({ addKnowledgeAction: h.addKnowledgeAction }))

async function renderSection(onAdded?: () => void) {
  const { AddKnowledgeSection } = await import('@/components/dashboard/add-knowledge-section')
  return render(<AddKnowledgeSection onAdded={onAdded} />)
}

const questionBox = () => screen.getByLabelText(/question or title/i) as HTMLInputElement
const answerBox = () => screen.getByLabelText(/answer or context/i) as HTMLTextAreaElement
const submit = () => screen.getByRole('button', { name: /add to knowledge base|adding/i }) as HTMLButtonElement

beforeEach(() => {
  vi.clearAllMocks()
  h.addKnowledgeAction.mockResolvedValue({ ok: true, articleId: 5 })
})

describe('AddKnowledgeSection', () => {
  it('keeps the submit button disabled until both a question and an answer are written', async () => {
    const user = userEvent.setup()
    await renderSection()
    expect(submit().disabled).toBe(true)
    await user.type(questionBox(), 'Do you ship to Canada?')
    expect(submit().disabled).toBe(true)
    await user.type(answerBox(), '   ')
    expect(submit().disabled).toBe(true)
    await user.type(answerBox(), 'Yes.')
    expect(submit().disabled).toBe(false)
  })

  it('submits the typed question and answer as form fields', async () => {
    const user = userEvent.setup()
    await renderSection()
    await user.type(questionBox(), 'Do you ship to Canada?')
    await user.type(answerBox(), 'Yes, within 5 days.')
    await user.click(submit())

    await waitFor(() => expect(h.addKnowledgeAction).toHaveBeenCalledOnce())
    const formData = h.addKnowledgeAction.mock.calls[0][1] as FormData
    expect(formData.get('question')).toBe('Do you ship to Canada?')
    expect(formData.get('answer')).toBe('Yes, within 5 days.')
  })

  it('on success clears both fields, confirms it, and tells the page to reload', async () => {
    const user = userEvent.setup()
    const onAdded = vi.fn()
    await renderSection(onAdded)
    await user.type(questionBox(), 'Do you ship to Canada?')
    await user.type(answerBox(), 'Yes, within 5 days.')
    await user.click(submit())

    expect((await screen.findByRole('status')).textContent).toMatch(/added/i)
    expect(questionBox().value).toBe('')
    expect(answerBox().value).toBe('')
    expect(onAdded).toHaveBeenCalledOnce()
    expect(submit().disabled).toBe(true)
  })

  it('on failure shows the message and keeps what was typed, without reloading', async () => {
    const user = userEvent.setup()
    const onAdded = vi.fn()
    h.addKnowledgeAction.mockResolvedValue({ error: 'Your knowledge base is full (2000 articles).' })
    await renderSection(onAdded)
    await user.type(questionBox(), 'Do you ship to Canada?')
    await user.type(answerBox(), 'Yes, within 5 days.')
    await user.click(submit())

    expect((await screen.findByRole('alert')).textContent).toContain('full (2000 articles)')
    expect(questionBox().value).toBe('Do you ship to Canada?')
    expect(answerBox().value).toBe('Yes, within 5 days.')
    expect(onAdded).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows a working state and blocks a second submit while the action is running', async () => {
    const user = userEvent.setup()
    let finish!: (v: unknown) => void
    h.addKnowledgeAction.mockReturnValue(new Promise((r) => { finish = r }))
    await renderSection()
    await user.type(questionBox(), 'Q?')
    await user.type(answerBox(), 'A.')
    await user.click(submit())

    await waitFor(() => expect(submit().textContent).toMatch(/adding/i))
    expect(submit().disabled).toBe(true)
    finish({ ok: true, articleId: 1 })
    await waitFor(() => expect(submit().textContent).toMatch(/add to knowledge base/i))
  })

  it('shows a live character count for the answer and enforces the input limits', async () => {
    const user = userEvent.setup()
    await renderSection()
    await user.type(answerBox(), 'hello')
    expect(screen.getByText('5 / 8000')).toBeTruthy()
    expect(questionBox().maxLength).toBe(500)
    expect(answerBox().maxLength).toBe(8000)
  })

  it('can add a second article right after the first succeeds', async () => {
    const user = userEvent.setup()
    const onAdded = vi.fn()
    await renderSection(onAdded)
    for (const [q, a] of [['One?', 'First.'], ['Two?', 'Second.']]) {
      await user.type(questionBox(), q)
      await user.type(answerBox(), a)
      await user.click(submit())
      await waitFor(() => expect(questionBox().value).toBe(''))
    }
    expect(h.addKnowledgeAction).toHaveBeenCalledTimes(2)
    expect(onAdded).toHaveBeenCalledTimes(2)
  })
})

describe('AddKnowledgeSection started from a ticket', () => {
  it('prefills the fields, sends the ticket id, and reports the draft consumed on success', async () => {
    const user = userEvent.setup()
    const onDraftConsumed = vi.fn()
    const { AddKnowledgeSection } = await import('@/components/dashboard/add-knowledge-section')
    render(
      <AddKnowledgeSection
        draft={{ ticketId: 12, question: 'Password reset', answer: 'Use the reset link.' }}
        onDraftConsumed={onDraftConsumed}
      />
    )
    await waitFor(() => expect(questionBox().value).toBe('Password reset'))
    expect(answerBox().value).toBe('Use the reset link.')

    await user.click(submit())
    await waitFor(() => expect(h.addKnowledgeAction).toHaveBeenCalledOnce())
    const formData = h.addKnowledgeAction.mock.calls[0][1] as FormData
    expect(formData.get('sourceTicketId')).toBe('12')
    await waitFor(() => expect(onDraftConsumed).toHaveBeenCalledOnce())
    expect(questionBox().value).toBe('')
  })

  it('sends no ticket id without a draft', async () => {
    const user = userEvent.setup()
    await renderSection()
    await user.type(questionBox(), 'Q')
    await user.type(answerBox(), 'A')
    await user.click(submit())
    await waitFor(() => expect(h.addKnowledgeAction).toHaveBeenCalledOnce())
    expect((h.addKnowledgeAction.mock.calls[0][1] as FormData).has('sourceTicketId')).toBe(false)
  })

  const draft = { ticketId: 12, question: 'Password reset', answer: 'Use the reset link.' }

  it('keeps the person\'s edits to the prefilled text and submits them', async () => {
    const user = userEvent.setup()
    const { AddKnowledgeSection } = await import('@/components/dashboard/add-knowledge-section')
    render(<AddKnowledgeSection draft={draft} />)
    await waitFor(() => expect(answerBox().value).toBe(draft.answer))
    await user.type(answerBox(), ' It expires in 1 hour.')
    expect(answerBox().value).toBe('Use the reset link. It expires in 1 hour.')
    expect(questionBox().value).toBe('Password reset')
    await user.click(submit())
    await waitFor(() => expect(h.addKnowledgeAction).toHaveBeenCalledOnce())
    const formData = h.addKnowledgeAction.mock.calls[0][1] as FormData
    expect(formData.get('answer')).toBe('Use the reset link. It expires in 1 hour.')
    expect(formData.get('sourceTicketId')).toBe('12')
  })

  it('tells the person the text came from a ticket, and not otherwise', async () => {
    const { AddKnowledgeSection } = await import('@/components/dashboard/add-knowledge-section')
    const { unmount } = render(<AddKnowledgeSection />)
    expect(screen.queryByText(/started from a ticket/i)).toBeNull()
    unmount()
    render(<AddKnowledgeSection draft={draft} />)
    expect(await screen.findByText(/started from a ticket/i)).toBeTruthy()
  })

  it('does not report the draft consumed when saving fails, and keeps the ticket link for a retry', async () => {
    const user = userEvent.setup()
    const onDraftConsumed = vi.fn()
    h.addKnowledgeAction.mockResolvedValueOnce({ error: 'Try again later.' })
    const { AddKnowledgeSection } = await import('@/components/dashboard/add-knowledge-section')
    render(<AddKnowledgeSection draft={draft} onDraftConsumed={onDraftConsumed} />)
    await waitFor(() => expect(questionBox().value).toBe('Password reset'))
    await user.click(submit())
    expect((await screen.findByRole('alert')).textContent).toContain('Try again later.')
    expect(onDraftConsumed).not.toHaveBeenCalled()
    expect(questionBox().value).toBe('Password reset')

    await user.click(submit())
    await waitFor(() => expect(h.addKnowledgeAction).toHaveBeenCalledTimes(2))
    expect((h.addKnowledgeAction.mock.calls[1][1] as FormData).get('sourceTicketId')).toBe('12')
    await waitFor(() => expect(onDraftConsumed).toHaveBeenCalledOnce())
  })

  it('omits the ticket id on a manual add that follows a consumed draft, and fires the callback only once', async () => {
    const user = userEvent.setup()
    const onDraftConsumed = vi.fn()
    const { AddKnowledgeSection } = await import('@/components/dashboard/add-knowledge-section')
    render(<AddKnowledgeSection draft={draft} onDraftConsumed={onDraftConsumed} />)
    await waitFor(() => expect(questionBox().value).toBe('Password reset'))
    await user.click(submit())
    await waitFor(() => expect(onDraftConsumed).toHaveBeenCalledOnce())
    await waitFor(() => expect(questionBox().value).toBe(''))

    await user.type(questionBox(), 'Another?')
    await user.type(answerBox(), 'Yes.')
    await user.click(submit())
    await waitFor(() => expect(h.addKnowledgeAction).toHaveBeenCalledTimes(2))
    expect((h.addKnowledgeAction.mock.calls[1][1] as FormData).has('sourceTicketId')).toBe(false)
    expect(onDraftConsumed).toHaveBeenCalledOnce()
  })
})
