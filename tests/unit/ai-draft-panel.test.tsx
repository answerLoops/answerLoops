// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIDraftPanel } from '@/components/tickets/ai-draft-panel'

vi.mock('@/lib/actions/tickets', () => ({
  updateAIDraftAction: vi.fn(async () => null),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

// userEvent.setup() installs its own navigator.clipboard stub, so the fake must
// be planted after setup() to win.
function withClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

describe('AIDraftPanel — Copy draft button', () => {
  it('copies the draft text to the clipboard when clicked', async () => {
    const user = userEvent.setup()
    const writeText = withClipboard()
    render(<AIDraftPanel ticketId={1} draft="The AI answer" status="posted" />)

    await user.click(screen.getByRole('button', { name: /copy draft/i }))

    expect(writeText).toHaveBeenCalledWith('The AI answer')
  })

  it('flips the button label to "Copied" after a copy', async () => {
    const user = userEvent.setup()
    withClipboard()
    render(<AIDraftPanel ticketId={1} draft="The AI answer" status="posted" />)

    await user.click(screen.getByRole('button', { name: /copy draft/i }))

    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  it('renders the Copy draft button even when status is "approved" (Approve/Edit/Dismiss hidden)', async () => {
    withClipboard()
    render(<AIDraftPanel ticketId={1} draft="The AI answer" status="approved" />)

    expect(screen.getByRole('button', { name: /copy draft/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^dismiss$/i })).toBeNull()
  })

  it('copies the edited text when the draft is being edited', async () => {
    const user = userEvent.setup()
    const writeText = withClipboard()
    render(<AIDraftPanel ticketId={1} draft="original" status="posted" />)

    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    const textarea = screen.getByRole('textbox')
    await user.clear(textarea)
    await user.type(textarea, 'my edited answer')

    await user.click(screen.getByRole('button', { name: /copy draft/i }))

    expect(writeText).toHaveBeenCalledWith('my edited answer')
  })
})

// answerLoops replies in Circle, so a Circle draft reads like every other
// platform's: approving or editing posts it as a comment on the Circle post.
describe('AIDraftPanel — Circle wording', () => {
  it('offers to save and post the edited answer to Circle', async () => {
    const user = userEvent.setup()
    render(<AIDraftPanel ticketId={1} draft="The AI answer" status="posted" sourcePlatform="circle" />)

    await user.click(screen.getByRole('button', { name: /^edit$/i }))

    expect(screen.getByRole('button', { name: 'Save & post to Circle' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save answer' })).toBeNull()
  })

  it('says a posted Circle draft was posted, with no copy-by-hand wording', () => {
    render(<AIDraftPanel ticketId={1} draft="The AI answer" status="posted" sourcePlatform="circle" />)

    expect(screen.getByText(/posted to circle/i)).toBeTruthy()
    expect(screen.queryByText(/by hand/i)).toBeNull()
  })

  it('keeps the post wording for other platforms', async () => {
    const user = userEvent.setup()
    render(<AIDraftPanel ticketId={1} draft="The AI answer" status="posted" sourcePlatform="slack" />)

    expect(screen.getByText(/posted to slack/i)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    expect(screen.getByRole('button', { name: 'Save & post to Slack' })).toBeTruthy()
  })
})
