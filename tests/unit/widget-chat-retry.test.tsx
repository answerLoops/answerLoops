// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Message } from '@ag-ui/client'
import { saveTranscript, beginRecovery } from '@/lib/widget/transcript'
import { REPLY_FAILURE_COPY } from '@/lib/widget/reply-failure'

/**
 * A reply that does not come through, in the real WidgetChat: a friendly
 * bubble instead of the server's text, Retry that sends the same question once
 * without adding it again, the question surviving a reload with Retry still
 * offered, and the "session timed out" recovery left to itself. The agent is
 * faked as in widget-chat-component.test.tsx.
 */

type Subscriber = {
  onEvent?: (p: { messages: Message[] }) => void
  onRunInitialized?: () => void
  onRunFinalized?: () => void
  onRunFailed?: (p: { error: Error }) => void
}

function makeFakeAgent(initial: Message[] = []) {
  let messages = initial
  let subscriber: Subscriber | undefined
  const agent = {
    get messages() {
      return messages
    },
    addMessage: vi.fn((m: Message) => {
      messages = [...messages, m]
    }),
    setMessages: vi.fn((m: Message[]) => {
      messages = m
    }),
    runAgent: vi.fn(async () => {}),
    subscribe: vi.fn((s: Subscriber) => {
      subscriber = s
      return { unsubscribe: vi.fn() }
    }),
  }
  return {
    agent,
    started: () => act(() => subscriber?.onRunInitialized?.()),
    finished: () => act(() => subscriber?.onRunFinalized?.()),
    failed: (message = 'HTTP 503: Upstream model timed out at gateway') =>
      act(() => {
        subscriber?.onRunFailed?.({ error: new Error(message) })
        subscriber?.onRunFinalized?.()
      }),
  }
}

const h = vi.hoisted(() => ({ current: null as ReturnType<typeof makeFakeAgent> | null }))

vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
vi.mock('@copilotkit/react-core/v2', () => ({
  CopilotKitProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@copilotkit/react-core/v2/headless', () => ({
  useAgent: () => ({ agent: h.current!.agent, isReady: true }),
  useRenderTool: () => {},
  useRenderToolCall: () => vi.fn(() => null),
}))

const TOKEN = 'a'.repeat(48)

async function renderWidget(fake = makeFakeAgent()) {
  h.current = fake
  const { WidgetChat } = await import('@/app/widget/[widgetToken]/widget-chat')
  render(<WidgetChat widgetToken={TOKEN} renderToken="test-render-token" orgName="Acme" showBranding isSelfPreview leadCaptureMode="off" />)
  return fake
}

const bubble = () => screen.queryByTestId('reply-failed')
const retry = () => screen.getByRole('button', { name: /Retry/ })

async function askAndFail(fake: ReturnType<typeof makeFakeAgent>, message?: string) {
  await userEvent.setup().type(screen.getByRole('textbox', { name: 'Your question' }), 'How do I export?{Enter}')
  await fake.started()
  await fake.failed(message)
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
})

describe('WidgetChat: a reply that does not come through', () => {
  it('shows plain words and Retry in the assistant’s bubble, never the server text, even in the owner’s preview', async () => {
    const fake = await renderWidget()
    await askAndFail(fake)
    expect(bubble()).not.toBeNull()
    expect(screen.getByText(REPLY_FAILURE_COPY.busy)).toBeTruthy()
    expect(screen.queryByText(/Upstream|gateway|503/)).toBeNull()
    expect(retry()).toBeEnabled()
    // The detail stays in the console.
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('did not come through'), expect.any(Error))
    // Announced politely.
    expect(bubble()!.querySelector('output[aria-live="polite"]')?.textContent).toBe(REPLY_FAILURE_COPY.busy)
  })

  it('says the visitor is offline when the browser has lost its connection, whatever the error says', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    const fake = await renderWidget()
    await askAndFail(fake, 'HTTP 503: Service Unavailable')
    expect(screen.getByText(REPLY_FAILURE_COPY.offline)).toBeTruthy()
  })

  it('keeps the question on screen', async () => {
    const fake = await renderWidget()
    await askAndFail(fake)
    expect(screen.getByText('How do I export?')).toBeTruthy()
  })
})

describe('WidgetChat: Retry', () => {
  it('sends the same question again once, without adding a second copy of it', async () => {
    const fake = await renderWidget()
    await askAndFail(fake)
    expect(fake.agent.addMessage).toHaveBeenCalledTimes(1)
    expect(fake.agent.runAgent).toHaveBeenCalledTimes(1)

    fireEvent.click(retry())
    expect(fake.agent.runAgent).toHaveBeenCalledTimes(2)
    expect(fake.agent.addMessage).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText('How do I export?')).toHaveLength(1)
  })

  it('sends once when Retry is pressed twice in the same instant', async () => {
    const fake = await renderWidget()
    await askAndFail(fake)
    const button = retry()
    act(() => {
      button.click()
      button.click()
    })
    expect(fake.agent.runAgent).toHaveBeenCalledTimes(2)
  })

  it('still sends the question when the agent comes back empty after the failure', async () => {
    const fake = await renderWidget()
    await askAndFail(fake)
    // After a failed run the client can hand the chat a fresh agent with no messages.
    fake.agent.setMessages([])
    fake.agent.setMessages.mockClear()
    fireEvent.click(retry())
    expect(fake.agent.setMessages).toHaveBeenCalledWith([expect.objectContaining({ role: 'user', content: 'How do I export?' })])
    expect(fake.agent.runAgent).toHaveBeenCalledTimes(2)
    expect(fake.agent.addMessage).toHaveBeenCalledTimes(1)
  })

  it('shows it is working and cannot be pressed twice while the retry runs', async () => {
    const fake = await renderWidget()
    await askAndFail(fake)
    fireEvent.click(retry())
    await fake.started()
    expect(retry()).toBeDisabled()
    expect(retry()).toHaveTextContent('Retrying…')
    fireEvent.click(retry())
    expect(fake.agent.runAgent).toHaveBeenCalledTimes(2)
    // The bubble shows the work, so the typing dots do not show as well.
    expect(screen.queryByTestId('typing-indicator')).toBeNull()
  })

  it('removes the bubble when the reply comes through', async () => {
    const fake = await renderWidget()
    await askAndFail(fake)
    fireEvent.click(retry())
    await fake.started()
    await fake.finished()
    expect(bubble()).toBeNull()
  })

  it('keeps the bubble, with Retry available, when it fails again', async () => {
    const fake = await renderWidget()
    await askAndFail(fake)
    fireEvent.click(retry())
    await fake.started()
    await fake.failed('HTTP 500: still broken')
    expect(bubble()).not.toBeNull()
    expect(screen.getByText(REPLY_FAILURE_COPY.general)).toBeTruthy()
    expect(retry()).toBeEnabled()
    expect(retry()).toHaveTextContent(/^Retry$/)
  })

  it('a new question typed instead replaces the bubble', async () => {
    const fake = await renderWidget()
    await askAndFail(fake)
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Your question' }), 'Something else{Enter}')
    expect(bubble()).toBeNull()
    expect(fake.agent.addMessage).toHaveBeenCalledTimes(2)
  })
})

describe('WidgetChat: after a reload', () => {
  const unanswered: Message[] = [
    { id: 'u0', role: 'user', content: 'Earlier question' },
    { id: 'a0', role: 'assistant', content: 'Earlier answer.' },
    { id: 'u1', role: 'user', content: 'The question that failed' },
  ]

  it('still shows the question that failed, and offers Retry for it', async () => {
    saveTranscript(TOKEN, unanswered)
    const fake = await renderWidget(makeFakeAgent())
    expect(screen.getByText('The question that failed')).toBeTruthy()
    expect(screen.getByText(REPLY_FAILURE_COPY.general)).toBeTruthy()

    fireEvent.click(retry())
    expect(fake.agent.setMessages).toHaveBeenCalledWith(unanswered)
    expect(fake.agent.runAgent).toHaveBeenCalledTimes(1)
    expect(fake.agent.addMessage).not.toHaveBeenCalled()
  })

  it('offers nothing when the restored conversation ended with an answer', async () => {
    saveTranscript(TOKEN, unanswered.slice(0, 2))
    await renderWidget(makeFakeAgent())
    expect(bubble()).toBeNull()
  })

  it('leaves an automatic "timed out" recovery to itself', async () => {
    saveTranscript(TOKEN, unanswered.slice(0, 2))
    beginRecovery(TOKEN, 'The question that failed')
    await renderWidget(makeFakeAgent())
    expect(bubble()).toBeNull()
  })
})

describe('WidgetChat: an expired pass is not a Retry case', () => {
  it('keeps the "session timed out" screen and shows no Retry bubble', async () => {
    const fake = await renderWidget()
    // A recovery a moment ago means this refusal goes to the timed-out screen.
    beginRecovery(TOKEN, 'earlier')
    await askAndFail(fake, 'HTTP 403: Forbidden')
    expect(screen.getByTestId('session-expired')).toBeTruthy()
    expect(bubble()).toBeNull()
  })
})
