// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WidgetAnswersSettings } from '@/components/settings/widget-answers'

/**
 * The answer-scope dropdown and guidance note in Settings → Widget: what an
 * owner or admin can change, what a member only sees, and how a failed save
 * leaves the controls.
 */

const h = vi.hoisted(() => ({
  saveWidgetAnswerScopeAction: vi.fn(),
  saveWidgetGuidanceAction: vi.fn(),
}))

vi.mock('@/lib/actions/widget', () => ({
  saveWidgetAnswerScopeAction: h.saveWidgetAnswerScopeAction,
  saveWidgetGuidanceAction: h.saveWidgetGuidanceAction,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const scopeSelect = () => screen.getByLabelText('What the widget answers from') as HTMLSelectElement
const guidanceBox = () => screen.getByLabelText('Guidance for the widget') as HTMLTextAreaElement
const saveButton = () => screen.getByRole('button', { name: /save guidance|saving/i })

describe('an owner or admin', () => {
  it('sees the saved scope and note', () => {
    render(<WidgetAnswersSettings canManage initialScope="knowledge-base-only" initialGuidance="Be warm." />)
    expect(scopeSelect().value).toBe('knowledge-base-only')
    expect(guidanceBox().value).toBe('Be warm.')
  })

  it('explains the chosen scope in plain words', () => {
    render(<WidgetAnswersSettings canManage initialScope="knowledge-base-only" initialGuidance={null} />)
    expect(screen.getByText(/answers only from your published articles/i)).toBeTruthy()
  })

  it('changes the scope, sends it to the server and says it saved', async () => {
    h.saveWidgetAnswerScopeAction.mockResolvedValue({ scope: 'general' })
    render(<WidgetAnswersSettings canManage initialScope="knowledge-base-only" initialGuidance={null} />)
    await userEvent.selectOptions(scopeSelect(), 'general')
    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy())
    const fd = h.saveWidgetAnswerScopeAction.mock.calls[0][1] as FormData
    expect(fd.get('scope')).toBe('general')
    expect(scopeSelect().value).toBe('general')
    expect(screen.getByText(/and, when they do not cover a question, from general knowledge/i)).toBeTruthy()
  })

  it('puts the scope back and shows the error when the save is refused', async () => {
    h.saveWidgetAnswerScopeAction.mockResolvedValue({ error: 'You do not have permission to do that.' })
    render(<WidgetAnswersSettings canManage initialScope="knowledge-base-only" initialGuidance={null} />)
    await userEvent.selectOptions(scopeSelect(), 'general')
    await waitFor(() => expect(screen.getByText('You do not have permission to do that.')).toBeTruthy())
    expect(scopeSelect().value).toBe('knowledge-base-only')
  })

  it('cannot change the scope again while a save is in flight', async () => {
    let finish: (v: unknown) => void = () => undefined
    h.saveWidgetAnswerScopeAction.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    render(<WidgetAnswersSettings canManage initialScope="knowledge-base-only" initialGuidance={null} />)
    await userEvent.selectOptions(scopeSelect(), 'general')
    expect(scopeSelect().disabled).toBe(true)
    finish({ scope: 'general' })
    await waitFor(() => expect(scopeSelect().disabled).toBe(false))
  })

  it('cannot save guidance until it has changed', async () => {
    render(<WidgetAnswersSettings canManage initialScope="general" initialGuidance="Be warm." />)
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(guidanceBox(), ' Be brief.')
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows what was actually stored after saving, not what was typed', async () => {
    h.saveWidgetGuidanceAction.mockResolvedValue({ guidance: 'Be warm.' })
    render(<WidgetAnswersSettings canManage initialScope="general" initialGuidance={null} />)
    await userEvent.type(guidanceBox(), '   Be warm.   ')
    await userEvent.click(saveButton())
    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy())
    expect(guidanceBox().value).toBe('Be warm.')
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)
    const fd = h.saveWidgetGuidanceAction.mock.calls[0][1] as FormData
    expect(fd.get('guidance')).toBe('   Be warm.   ')
  })

  it('keeps the typed note and shows the error when the save fails', async () => {
    h.saveWidgetGuidanceAction.mockResolvedValue({ error: 'Keep guidance under 600 characters' })
    render(<WidgetAnswersSettings canManage initialScope="general" initialGuidance={null} />)
    await userEvent.type(guidanceBox(), 'Be warm.')
    await userEvent.click(saveButton())
    await waitFor(() => expect(screen.getByText('Keep guidance under 600 characters')).toBeTruthy())
    expect(guidanceBox().value).toBe('Be warm.')
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false)
  })

  it('counts characters against the limit and stops typing at it', async () => {
    render(<WidgetAnswersSettings canManage initialScope="general" initialGuidance="Be warm." />)
    expect(screen.getByText('8 / 600')).toBeTruthy()
    expect(guidanceBox().maxLength).toBe(600)
  })

  it('can clear the note by emptying the box and saving', async () => {
    h.saveWidgetGuidanceAction.mockResolvedValue({ guidance: null })
    render(<WidgetAnswersSettings canManage initialScope="general" initialGuidance="Be warm." />)
    await userEvent.clear(guidanceBox())
    await userEvent.click(saveButton())
    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy())
    expect(guidanceBox().value).toBe('')
  })
})

describe('examples of each choice', () => {
  const example = (scope: string) => screen.getByTestId(`widget-answer-scope-example-${scope}`)

  it('shows what a visitor would see under both choices for the same uncovered question', () => {
    render(<WidgetAnswersSettings canManage initialScope="general" initialGuidance={null} />)
    expect(screen.getByText(/a visitor asks .Can I pay by invoice\?. and none of your articles cover it/i)).toBeTruthy()
    expect(example('knowledge-base-only').textContent).toMatch(/I don't have information about paying by invoice/)
    expect(example('knowledge-base-only').textContent).toMatch(/email, phone or support page from your articles/i)
    expect(example('general').textContent).toMatch(/invoices are usually available on annual plans/i)
    expect(example('general').textContent).toMatch(/not taken from your articles, so it can be wrong/i)
  })

  it('marks the example for the saved choice', () => {
    render(<WidgetAnswersSettings canManage initialScope="knowledge-base-only" initialGuidance={null} />)
    expect(example('knowledge-base-only').dataset.selected).toBe('true')
    expect(example('general').dataset.selected).toBe('false')
  })

  it('moves the mark when the choice changes, and back if the save is refused', async () => {
    h.saveWidgetAnswerScopeAction.mockResolvedValueOnce({ scope: 'general' })
    render(<WidgetAnswersSettings canManage initialScope="knowledge-base-only" initialGuidance={null} />)
    await userEvent.selectOptions(scopeSelect(), 'general')
    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy())
    expect(example('general').dataset.selected).toBe('true')
    expect(example('knowledge-base-only').dataset.selected).toBe('false')

    h.saveWidgetAnswerScopeAction.mockResolvedValueOnce({ error: 'You do not have permission to do that.' })
    await userEvent.selectOptions(scopeSelect(), 'knowledge-base-only')
    await waitFor(() => expect(screen.getByText('You do not have permission to do that.')).toBeTruthy())
    expect(example('general').dataset.selected).toBe('true')
  })

  it('says in plain words that knowledge-base-only offers contact details and still answers greetings', () => {
    render(<WidgetAnswersSettings canManage initialScope="knowledge-base-only" initialGuidance={null} />)
    expect(screen.getByText(/shows the contact details from your articles, or suggests contacting you directly/i)).toBeTruthy()
    expect(screen.getByText(/always replies to a greeting or thanks/i)).toBeTruthy()
  })

  it('shows members the examples too, without controls', () => {
    render(<WidgetAnswersSettings canManage={false} initialScope="knowledge-base-only" initialGuidance={null} />)
    expect(example('knowledge-base-only').dataset.selected).toBe('true')
    expect(screen.queryByLabelText('What the widget answers from')).toBeNull()
  })

  it('marks the general example for a member whose workspace answers from general knowledge', () => {
    render(<WidgetAnswersSettings canManage={false} initialScope="general" initialGuidance={null} />)
    expect(example('general').dataset.selected).toBe('true')
    expect(example('knowledge-base-only').dataset.selected).toBe('false')
  })
})

describe('a member who cannot manage the widget', () => {
  it('sees the settings as text with no controls', () => {
    render(<WidgetAnswersSettings canManage={false} initialScope="knowledge-base-only" initialGuidance="Be warm." />)
    expect(screen.queryByLabelText('What the widget answers from')).toBeNull()
    expect(screen.queryByLabelText('Guidance for the widget')).toBeNull()
    expect(screen.queryByRole('button', { name: /save guidance/i })).toBeNull()
    expect(screen.getByText(/Only from my knowledge base\. Only owners and admins can change this\./)).toBeTruthy()
    expect(screen.getByText(/Be warm\. Only owners and admins can change this\./)).toBeTruthy()
  })

  it('is told when no guidance is set', () => {
    render(<WidgetAnswersSettings canManage={false} initialScope="general" initialGuidance={null} />)
    expect(screen.getByText(/No guidance set\. Only owners and admins can change this\./)).toBeTruthy()
  })
})
