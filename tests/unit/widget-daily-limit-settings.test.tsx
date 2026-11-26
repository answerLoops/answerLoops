// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WidgetDailyLimitSettings } from '@/components/settings/widget-daily-limit'

/**
 * Behavioral coverage for the daily answer limit control in the widget
 * section of Settings. The server action itself is mocked; what is under test
 * is how the control reacts to the saved value, edits, and the action's
 * result, and what a member sees instead of the control.
 */

const h = vi.hoisted(() => ({
  saveWidgetDailyLimitAction: vi.fn(),
}))

vi.mock('@/lib/actions/widget', () => ({
  saveWidgetDailyLimitAction: h.saveWidgetDailyLimitAction,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function input() {
  return screen.getByLabelText('Daily answer limit') as HTMLInputElement
}

function saveButton() {
  return screen.getByRole('button', { name: /Save limit|Saving…/ }) as HTMLButtonElement
}

describe('WidgetDailyLimitSettings: owners and admins', () => {
  it('starts empty with the ceiling as the placeholder when no limit of their own is saved', () => {
    render(<WidgetDailyLimitSettings canManage initialLimit={null} ceiling={5000} />)
    expect(input().value).toBe('')
    expect(input().placeholder).toBe('5,000')
    expect(saveButton().disabled).toBe(true)
  })

  it('starts from the saved limit', () => {
    render(<WidgetDailyLimitSettings canManage initialLimit={250} ceiling={5000} />)
    expect(input().value).toBe('250')
    expect(saveButton().disabled).toBe(true)
  })

  it('enables Save only while the value differs from what is saved', async () => {
    const user = userEvent.setup()
    render(<WidgetDailyLimitSettings canManage initialLimit={250} ceiling={5000} />)

    await user.clear(input())
    await user.type(input(), '300')
    expect(saveButton().disabled).toBe(false)

    await user.clear(input())
    await user.type(input(), '250')
    expect(saveButton().disabled).toBe(true)

    // Surrounding spaces do not count as a change.
    await user.type(input(), ' ')
    expect(saveButton().disabled).toBe(true)
  })

  it('sends the typed value as "limit", then shows Saved. and the stored value', async () => {
    h.saveWidgetDailyLimitAction.mockResolvedValue({ limit: 1200 })
    const user = userEvent.setup()
    render(<WidgetDailyLimitSettings canManage initialLimit={null} ceiling={5000} />)

    await user.type(input(), '1,200')
    await user.click(saveButton())

    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy())
    expect(h.saveWidgetDailyLimitAction).toHaveBeenCalledTimes(1)
    const [, fd] = h.saveWidgetDailyLimitAction.mock.calls[0] as [unknown, FormData]
    expect(fd.get('limit')).toBe('1,200')
    // The input is replaced with what the server stored, and that is now the
    // saved value, so Save goes back to disabled.
    expect(input().value).toBe('1200')
    expect(saveButton().disabled).toBe(true)
  })

  it('clears the input when the stored limit comes back as null', async () => {
    h.saveWidgetDailyLimitAction.mockResolvedValue({ limit: null })
    const user = userEvent.setup()
    render(<WidgetDailyLimitSettings canManage initialLimit={250} ceiling={5000} />)

    await user.clear(input())
    await user.click(saveButton())

    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy())
    const [, fd] = h.saveWidgetDailyLimitAction.mock.calls[0] as [unknown, FormData]
    expect(fd.get('limit')).toBe('')
    expect(input().value).toBe('')
    expect(saveButton().disabled).toBe(true)
  })

  it('shows the error and keeps the typed value when the save is refused', async () => {
    h.saveWidgetDailyLimitAction.mockResolvedValue({ error: 'Enter a number no higher than 5,000.' })
    const user = userEvent.setup()
    render(<WidgetDailyLimitSettings canManage initialLimit={250} ceiling={5000} />)

    await user.clear(input())
    await user.type(input(), '99999')
    await user.click(saveButton())

    await waitFor(() => expect(screen.getByText('Enter a number no higher than 5,000.')).toBeTruthy())
    expect(screen.queryByText('Saved.')).toBeNull()
    expect(input().value).toBe('99999')
    // Nothing was stored, so the edit still counts as unsaved.
    expect(saveButton().disabled).toBe(false)
  })

  it('disables the button and shows Saving… while the action is in flight', async () => {
    let resolve!: (v: { limit: number }) => void
    h.saveWidgetDailyLimitAction.mockReturnValue(new Promise((r) => (resolve = r)))
    const user = userEvent.setup()
    render(<WidgetDailyLimitSettings canManage initialLimit={null} ceiling={5000} />)

    await user.type(input(), '10')
    await user.click(saveButton())

    expect(saveButton().textContent).toBe('Saving…')
    expect(saveButton().disabled).toBe(true)

    resolve({ limit: 10 })
    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy())
    expect(saveButton().textContent).toBe('Save limit')
  })

  it('clears an earlier message when a new save starts', async () => {
    h.saveWidgetDailyLimitAction.mockResolvedValueOnce({ error: 'Too high.' })
    let resolve!: (v: { limit: number }) => void
    h.saveWidgetDailyLimitAction.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const user = userEvent.setup()
    render(<WidgetDailyLimitSettings canManage initialLimit={null} ceiling={5000} />)

    await user.type(input(), '99999')
    await user.click(saveButton())
    await waitFor(() => expect(screen.getByText('Too high.')).toBeTruthy())

    await user.clear(input())
    await user.type(input(), '10')
    await user.click(saveButton())
    expect(screen.queryByText('Too high.')).toBeNull()
    resolve({ limit: 10 })
    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy())
  })
})

describe('WidgetDailyLimitSettings: members', () => {
  it('shows the saved limit as text, with no input or button', () => {
    render(<WidgetDailyLimitSettings canManage={false} initialLimit={1500} ceiling={5000} />)
    expect(screen.queryByLabelText('Daily answer limit')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('1,500 answers a day. Only owners and admins can change this.')).toBeTruthy()
  })

  it('shows the ceiling when no limit of their own is saved', () => {
    render(<WidgetDailyLimitSettings canManage={false} initialLimit={null} ceiling={5000} />)
    expect(screen.getByText('5,000 answers a day. Only owners and admins can change this.')).toBeTruthy()
    expect(h.saveWidgetDailyLimitAction).not.toHaveBeenCalled()
  })
})
