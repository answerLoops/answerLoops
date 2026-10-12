// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The dashboard's "Add to the knowledge base" form: what it lets a person
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
