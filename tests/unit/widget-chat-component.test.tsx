// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Message } from '@ag-ui/client'

/**
 * WidgetChat's own logic — the email gate, send/loading/error state, and the
 * CopilotKit `useAgent` wiring — rather than the CopilotKit runtime itself
 * (that's the widget-chat-quota-and-validation / widget-kb-only-context
 * route-level suites). `useAgent` is faked with a minimal AbstractAgent-shaped
 * object under direct test control: `addMessage`/`runAgent` are spies, and
 * `subscribe` stores the callbacks the component registers so a test can fire
 * them (onEvent/onRunInitialized/onRunFinalized/onRunFailed) to drive the
 * component through a real run's lifecycle without a live runtime.
 */

const h = vi.hoisted(() => ({
  fetchMock: vi.fn(async () => new Response(null, { status: 200 })),
}))

vi.stubGlobal('fetch', h.fetchMock)

type Subscriber = {
  onEvent?: (p: { messages: Message[] }) => void
  onRunInitialized?: () => void
  onRunFinalized?: () => void
  onRunFailed?: () => void
}

function makeFakeAgent(initialMessages: Message[] = []) {
  let messages = initialMessages
  let subscriber: Subscriber | undefined
  const addMessage = vi.fn((m: Message) => {
    messages = [...messages, m]
  })
  const runAgent = vi.fn(async () => {})
  return {
    agent: {
      get messages() {
        return messages
      },
      addMessage,
      runAgent,
      subscribe: vi.fn((s: Subscriber) => {
        subscriber = s
        return { unsubscribe: vi.fn() }
      }),
    },
    // Test-only helpers, not part of the real AbstractAgent surface. Wrapped
    // in act() since these fire state updates outside any user-event or
    // render call that would otherwise batch them for the test.
    emit: {
      event: (msgs: Message[]) => act(() => subscriber?.onEvent?.({ messages: msgs })),
      runInitialized: () => act(() => subscriber?.onRunInitialized?.()),
      runFinalized: () => act(() => subscriber?.onRunFinalized?.()),
      runFailed: () => act(() => subscriber?.onRunFailed?.()),
    },
    addMessage,
    runAgent,
  }
}

const h2 = vi.hoisted(() => ({ current: null as ReturnType<typeof makeFakeAgent> | null }))

vi.mock('@copilotkit/react-core/v2', () => ({
  CopilotKitProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@copilotkit/react-core/v2/headless', () => ({
  useAgent: () => ({ agent: h2.current!.agent, isReady: true }),
}))

async function renderWidget(fake: ReturnType<typeof makeFakeAgent>) {
  h2.current = fake
  const { WidgetChat } = await import('@/app/widget/[widgetToken]/widget-chat')
  return render(<WidgetChat widgetToken={'a'.repeat(48)} orgName="Acme" showBranding />)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  localStorage.clear()
})

describe('WidgetChat: email gate', () => {
  it('shows the message thread only after the email gate is passed', async () => {
    await renderWidget(makeFakeAgent())
    expect(screen.queryByPlaceholderText('Ask a question…')).toBeNull()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    expect(screen.getByPlaceholderText('Ask a question…')).toBeTruthy()
  })

  it('posts the email to the lead endpoint and then reveals the thread', async () => {
    await renderWidget(makeFakeAgent())
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText('you@example.com'), 'visitor@example.com')
    await user.click(screen.getByRole('button', { name: 'Start chat' }))

    await waitFor(() => expect(screen.getByPlaceholderText('Ask a question…')).toBeTruthy())
    expect(h.fetchMock).toHaveBeenCalledWith(
      '/api/widget/lead',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ widgetToken: 'a'.repeat(48), email: 'visitor@example.com' }),
      })
    )
  })

  it('still reveals the thread when the lead request fails, non-blocking', async () => {
    h.fetchMock.mockRejectedValueOnce(new Error('network down'))
    await renderWidget(makeFakeAgent())
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText('you@example.com'), 'visitor@example.com')
    await user.click(screen.getByRole('button', { name: 'Start chat' }))

    await waitFor(() => expect(screen.getByPlaceholderText('Ask a question…')).toBeTruthy())
  })
})

describe('WidgetChat: sending a message', () => {
  it('adds the user message to the agent and starts a run, clearing the input', async () => {
    const fake = makeFakeAgent()
    await renderWidget(fake)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    const input = screen.getByPlaceholderText('Ask a question…') as HTMLInputElement
    await user.type(input, 'how do I install this?{Enter}')

    expect(fake.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: 'how do I install this?' })
    )
    expect(fake.runAgent).toHaveBeenCalledOnce()
    expect(input.value).toBe('')
  })

  it('does not submit an empty or whitespace-only message', async () => {
    const fake = makeFakeAgent()
    await renderWidget(fake)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    const input = screen.getByPlaceholderText('Ask a question…')
    await user.type(input, '   ')
    await user.keyboard('{Enter}')

    expect(fake.addMessage).not.toHaveBeenCalled()
    expect(fake.runAgent).not.toHaveBeenCalled()
  })

  it('renders messages the agent reports via onEvent, in order', async () => {
    const fake = makeFakeAgent()
    await renderWidget(fake)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    fake.emit.event([
      { id: '1', role: 'user', content: 'hi' } as Message,
      { id: '2', role: 'assistant', content: 'hello, how can I help?' } as Message,
    ])

    expect(screen.getByText('hi')).toBeTruthy()
    expect(screen.getByText('hello, how can I help?')).toBeTruthy()
  })
})

describe('WidgetChat: run lifecycle', () => {
  it('shows the typing indicator while a run is in progress and disables input', async () => {
    const fake = makeFakeAgent()
    await renderWidget(fake)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    fake.emit.runInitialized()

    const input = screen.getByPlaceholderText('Ask a question…') as HTMLInputElement
    expect(input.disabled).toBe(true)
  })

  it('clears the typing indicator and re-enables input once the run finishes', async () => {
    const fake = makeFakeAgent()
    await renderWidget(fake)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    fake.emit.runInitialized()
    fake.emit.runFinalized()

    const input = screen.getByPlaceholderText('Ask a question…') as HTMLInputElement
    expect(input.disabled).toBe(false)
  })

  it('shows an error message when a run fails, and clears it on the next attempt', async () => {
    const fake = makeFakeAgent()
    await renderWidget(fake)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    fake.emit.runInitialized()
    fake.emit.runFailed()

    expect(screen.getByText('Something went wrong. Please try again.')).toBeTruthy()

    fake.emit.runInitialized()
    expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull()
  })
})

describe('WidgetChat: branding', () => {
  it('shows the "Powered by" line when showBranding is true', async () => {
    h2.current = makeFakeAgent()
    const { WidgetChat } = await import('@/app/widget/[widgetToken]/widget-chat')
    render(<WidgetChat widgetToken={'a'.repeat(48)} orgName="Acme" showBranding />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    expect(screen.getByText('Powered by answerLoops')).toBeTruthy()
  })

  it('hides the "Powered by" line when showBranding is false', async () => {
    h2.current = makeFakeAgent()
    const { WidgetChat } = await import('@/app/widget/[widgetToken]/widget-chat')
    render(<WidgetChat widgetToken={'a'.repeat(48)} orgName="Acme" showBranding={false} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    expect(screen.queryByText('Powered by answerLoops')).toBeNull()
  })
})
