// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Message } from '@ag-ui/client'
import {
  RECOVERY_WINDOW_MS,
  VISITOR_ID_STORAGE_KEY,
  beginRecovery,
  loadTranscript,
  saveTranscript,
} from '@/lib/widget/transcript'

/**
 * The conversation surviving a refresh, the "New chat" button, and the
 * automatic recovery from a refused call. The CopilotKit runtime is faked as in
 * widget-chat-component.test.tsx: only WidgetChat's own behaviour is under test.
 */

vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))

const TOKEN = 'a'.repeat(48)

type Subscriber = {
  onEvent?: (p: { messages: Message[] }) => void
  onRunInitialized?: () => void
  onRunFinalized?: () => void
  onRunFailed?: (p: { error: Error }) => void
}

function makeFakeAgent() {
  let messages: Message[] = []
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
    emit: {
      event: (m: Message[]) => act(() => subscriber?.onEvent?.({ messages: m })),
      runInitialized: () => act(() => subscriber?.onRunInitialized?.()),
      runFinalized: () => act(() => subscriber?.onRunFinalized?.()),
      runFailed: (message: string) => act(() => subscriber?.onRunFailed?.({ error: new Error(message) })),
    },
  }
}

const h = vi.hoisted(() => ({ current: null as ReturnType<typeof makeFakeAgent> | null }))

vi.mock('@copilotkit/react-core/v2', () => ({
  CopilotKitProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@copilotkit/react-core/v2/headless', () => ({
  useAgent: () => ({ agent: h.current!.agent, isReady: true }),
  useRenderTool: () => {},
  useRenderToolCall: () => () => null,
}))

async function renderChat(props: Record<string, unknown> = {}) {
  const { WidgetChat } = await import('@/app/widget/[widgetToken]/widget-chat')
  return render(
    <WidgetChat
      widgetToken={TOKEN}
      renderToken="t"
      orgName="Acme"
      showBranding
      isSelfPreview={false}
      leadCaptureMode="off"
      {...props}
    />
  )
}

const earlier: Message[] = [
  { id: 'u1', role: 'user', content: 'How do I connect Slack?' },
  { id: 'a1', role: 'assistant', content: 'Use the Add to Slack button.' },
]

let reload: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  localStorage.clear()
  sessionStorage.clear()
  h.current = makeFakeAgent()
  reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
})

afterEach(() => {
  reload.mockRestore()
  cleanup()
})

describe('the conversation after a refresh', () => {
  it('shows the earlier messages and not the welcome card', async () => {
    saveTranscript(TOKEN, earlier)
    await renderChat({ starterQuestions: ['What does it cost?'] })

    expect(screen.getByText('How do I connect Slack?')).toBeTruthy()
    expect(screen.getByText('Use the Add to Slack button.')).toBeTruthy()
    expect(screen.queryByTestId('welcome-card')).toBeNull()
    expect(screen.queryByTestId('starter-questions')).toBeNull()
  })

  it('shows the welcome card and starter questions when there is nothing saved', async () => {
    await renderChat({ starterQuestions: ['What does it cost?'] })
    expect(screen.getByTestId('welcome-card')).toBeTruthy()
    expect(screen.getByTestId('starter-questions')).toBeTruthy()
  })

  it('skips the email screen for a visitor who already has a conversation', async () => {
    saveTranscript(TOKEN, earlier)
    await renderChat({ leadCaptureMode: 'up-front' })
    expect(screen.queryByPlaceholderText('you@example.com')).toBeNull()
    expect(screen.getByPlaceholderText('Ask a question…')).toBeTruthy()
  })

  it('still shows the email screen first for a new visitor', async () => {
    await renderChat({ leadCaptureMode: 'up-front' })
    expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy()
  })

  it('gives the restored thread to the agent before the next message is sent, so the run carries the whole thread', async () => {
    saveTranscript(TOKEN, earlier)
    await renderChat()
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('Ask a question…'), 'and Discord?{Enter}')

    const agent = h.current!.agent
    expect(agent.setMessages).toHaveBeenCalledWith(earlier)
    expect(agent.messages.map((m) => m.content)).toEqual([
      'How do I connect Slack?',
      'Use the Add to Slack button.',
      'and Discord?',
    ])
    expect(agent.runAgent).toHaveBeenCalledOnce()
  })

  it('does not draw a conversation that has expired', async () => {
    saveTranscript(TOKEN, earlier, Date.now() - 25 * 60 * 60 * 1000)
    await renderChat()
    expect(screen.queryByText('How do I connect Slack?')).toBeNull()
    expect(screen.getByTestId('welcome-card')).toBeTruthy()
  })

  it('starts fresh, without an error, when storage is blocked', async () => {
    const spy = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    try {
      await renderChat()
      expect(screen.getByTestId('welcome-card')).toBeTruthy()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('keeping the conversation', () => {
  it('saves it when a reply has finished', async () => {
    await renderChat()
    const fake = h.current!
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('Ask a question…'), 'hello there{Enter}')
    fake.emit.runInitialized()
    fake.emit.event([...fake.agent.messages, { id: 'a9', role: 'assistant', content: 'Hi!' } as Message])
    // not saved while the reply is still arriving
    expect(loadTranscript(TOKEN).some((m) => m.id === 'a9')).toBe(false)
    fake.emit.runFinalized()

    expect(loadTranscript(TOKEN).map((m) => m.content)).toEqual(['hello there', 'Hi!'])
  })

  it('does not rewrite the saved conversation just because the chat was opened', async () => {
    const savedAt = Date.now() - 60 * 60 * 1000
    saveTranscript(TOKEN, earlier, savedAt)
    await renderChat()
    const raw = JSON.parse(localStorage.getItem(`al_chat:${TOKEN}`) ?? '{}')
    expect(raw.savedAt).toBe(savedAt)
  })
})

describe('New chat', () => {
  it('is not offered before there is a conversation', async () => {
    await renderChat()
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull()
  })

  it('keeps its name and a comfortable tap size, and drops only the visible word on a very narrow chat', async () => {
    saveTranscript(TOKEN, earlier)
    await renderChat()
    const button = screen.getByRole('button', { name: 'New chat' })
    expect(button.className).toContain('min-h-11')
    expect(button.className).toContain('min-w-11')
    expect(button.querySelector('span')?.className).toContain('max-[300px]:hidden')
  })

  it('clears the saved conversation, starts a new visitor id and reloads the chat', async () => {
    localStorage.setItem(VISITOR_ID_STORAGE_KEY, 'old-visitor-id')
    saveTranscript(TOKEN, earlier)
    await renderChat()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'New chat' }))

    expect(loadTranscript(TOKEN)).toEqual([])
    expect(localStorage.getItem(VISITOR_ID_STORAGE_KEY)).not.toBe('old-visitor-id')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not save the old conversation again while the page reloads', async () => {
    saveTranscript(TOKEN, earlier)
    await renderChat()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'New chat' }))
    expect(localStorage.getItem(`al_chat:${TOKEN}`)).toBeNull()
  })
})

describe('a refused call', () => {
  async function sendAndRefuse(question: string) {
    await renderChat()
    const fake = h.current!
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('Ask a question…'), `${question}{Enter}`)
    fake.emit.runInitialized()
    fake.emit.runFailed('HTTP 403: Forbidden')
    return fake
  }

  it('reloads the chat for a fresh pass instead of showing the timed-out prompt', async () => {
    await sendAndRefuse('what does it cost?')
    expect(reload).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('session-expired')).toBeNull()
    expect(screen.queryByText('Forbidden')).toBeNull()
  })

  it('keeps the earlier conversation but not the unanswered question, so it is not shown twice', async () => {
    saveTranscript(TOKEN, earlier)
    await renderChat()
    const fake = h.current!
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('Ask a question…'), 'what does it cost?{Enter}')
    fake.emit.runInitialized()
    fake.emit.runFailed('HTTP 403: Forbidden')

    expect(loadTranscript(TOKEN)).toEqual(earlier)
  })

  it('sends the held question again, once, after the reload', async () => {
    await sendAndRefuse('what does it cost?')
    cleanup()
    h.current = makeFakeAgent()
    vi.resetModules()

    await renderChat()
    const agent = h.current.agent
    expect(agent.runAgent).toHaveBeenCalledOnce()
    expect(agent.addMessage).toHaveBeenCalledOnce()
    expect(agent.addMessage).toHaveBeenCalledWith(expect.objectContaining({ role: 'user', content: 'what does it cost?' }))
    expect(screen.queryByPlaceholderText('you@example.com')).toBeNull()

    // and not again on a later render
    cleanup()
    h.current = makeFakeAgent()
    vi.resetModules()
    await renderChat()
    expect(h.current.agent.runAgent).not.toHaveBeenCalled()
  })

  it('shows the timed-out prompt, and does not reload, when it was just tried', async () => {
    beginRecovery(TOKEN, 'earlier attempt', Date.now() - (RECOVERY_WINDOW_MS - 5_000))
    await sendAndRefuse('what does it cost?')
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByTestId('session-expired')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start a new session' })).toBeTruthy()
  })

  it('shows the timed-out prompt when storage is blocked', async () => {
    const spy = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    try {
      await sendAndRefuse('what does it cost?')
      expect(reload).not.toHaveBeenCalled()
      expect(screen.getByTestId('session-expired')).toBeTruthy()
    } finally {
      spy.mockRestore()
    }
  })

  it('treats other failures as before: a message, no reload', async () => {
    await renderChat()
    const fake = h.current!
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('Ask a question…'), 'hello{Enter}')
    fake.emit.runInitialized()
    fake.emit.runFailed('HTTP 503: This assistant is temporarily unavailable.')
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByText('This assistant is temporarily unavailable.')).toBeTruthy()
  })
})

describe('a long conversation', () => {
  it('keeps what is sent within the chat endpoint limit', async () => {
    const long: Message[] = Array.from({ length: 24 }, (_, i) => [
      { id: `u${i}`, role: 'user', content: `q${i}` } as Message,
      { id: `a${i}`, role: 'assistant', content: `r${i}` } as Message,
    ]).flat()
    saveTranscript(TOKEN, long)
    await renderChat()
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('Ask a question…'), 'one more{Enter}')
    expect(h.current!.agent.messages.length).toBeLessThanOrEqual(50)
    expect(h.current!.agent.messages[h.current!.agent.messages.length - 1].content).toBe('one more')
  })
})
