// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Message } from '@ag-ui/client'

/**
 * Covers the new `leadCaptureMode` prop ('off' / 'on-failure') added to
 * WidgetChat. 'up-front' (the original hardcoded email gate) is already
 * covered by widget-chat-component.test.tsx and
 * widget-chat-cards-integration.test.tsx — not duplicated here. This suite
 * only exercises: skipping the gate for 'off'/'on-failure', and the
 * 'on-failure' inline failure-lead-prompt that appears after a run finishes
 * based on the /api/widget/lead-signal response, per lib/widget/lead-capture.ts.
 *
 * Mocking approach is lifted from widget-chat-component.test.tsx: `useAgent`
 * is faked with a minimal AbstractAgent-shaped object, `subscribe` captures
 * the callbacks WidgetChat registers, and `emit.*` fires them to drive the
 * component through a run's lifecycle without a live runtime.
 */

type Subscriber = {
  onEvent?: (p: { messages: Message[] }) => void
  onRunInitialized?: () => void
  onRunFinalized?: () => void
  onRunFailed?: (p: { error: Error }) => void
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
    // Test-only helpers, not part of the real AbstractAgent surface.
    emit: {
      event: (msgs: Message[]) => act(() => subscriber?.onEvent?.({ messages: msgs })),
      runInitialized: () => act(() => subscriber?.onRunInitialized?.()),
      // onRunFinalized triggers WidgetChat's fire-and-forget checkLeadSignal(),
      // which awaits a fetch + res.json() before any state update — wrap in
      // an async act() and flush a macrotask so that update lands before the
      // caller's next assertion.
      runFinalized: () =>
        act(async () => {
          subscriber?.onRunFinalized?.()
          await new Promise((resolve) => setTimeout(resolve, 0))
        }),
    },
    addMessage,
    runAgent,
  }
}

const h = vi.hoisted(() => ({
  current: null as ReturnType<typeof makeFakeAgent> | null,
  // Typed with fetch's real two-arg signature up front — mockImplementation
  // below narrows to a (url, init) callback, which a zero-arg-inferred mock
  // (the shape `vi.fn(async () => ...)` would infer) rejects at compile time.
  fetchMock: vi.fn(async (_input?: RequestInfo | URL, _init?: RequestInit): Promise<Response> => new Response(null, { status: 200 })),
}))

vi.stubGlobal('fetch', h.fetchMock)

vi.mock('@copilotkit/react-core/v2', () => ({
  CopilotKitProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@copilotkit/react-core/v2/headless', () => ({
  useAgent: () => ({ agent: h.current!.agent, isReady: true }),
  useRenderTool: () => {},
  useRenderToolCall: () => vi.fn(() => null),
}))

const TOKEN = 'a'.repeat(48)

async function renderWidget(fake: ReturnType<typeof makeFakeAgent>, mode: 'off' | 'on-failure' | 'up-front') {
  h.current = fake
  const { WidgetChat } = await import('@/app/widget/[widgetToken]/widget-chat')
  return render(
    <WidgetChat
      widgetToken={TOKEN}
      renderToken="test-render-token"
      orgName="Acme"
      showBranding
      isSelfPreview={false}
      leadCaptureMode={mode}
    />
  )
}

/** Makes the fetch mock answer any /api/widget/lead-signal POST with `signal`. */
function mockLeadSignalResponse(signal: string) {
  h.fetchMock.mockImplementation(async (url: unknown) => {
    if (typeof url === 'string' && url.includes('/api/widget/lead-signal')) {
      return new Response(JSON.stringify({ signal }), { status: 200 })
    }
    return new Response(null, { status: 200 })
  })
}

function leadSignalCalls() {
  return h.fetchMock.mock.calls.filter(([url]) => url === '/api/widget/lead-signal')
}

function leadCalls() {
  return h.fetchMock.mock.calls.filter(([url]) => url === '/api/widget/lead')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  localStorage.clear()
  mockLeadSignalResponse('none')
})

describe('WidgetChat: leadCaptureMode skips the up-front gate', () => {
  it("shows the chat input immediately in 'off' mode, with no email gate", async () => {
    await renderWidget(makeFakeAgent(), 'off')
    expect(screen.getByPlaceholderText('Ask a question…')).toBeTruthy()
    expect(screen.queryByText('Skip')).toBeNull()
  })

  it("shows the chat input immediately in 'on-failure' mode, with no email gate", async () => {
    await renderWidget(makeFakeAgent(), 'on-failure')
    expect(screen.getByPlaceholderText('Ask a question…')).toBeTruthy()
    expect(screen.queryByText('Skip')).toBeNull()
  })
})

describe('WidgetChat: on-failure lead prompt', () => {
  it('shows the failure-lead-prompt with its copy after a run finishes with a no-kb-match signal', async () => {
    mockLeadSignalResponse('no-kb-match')
    const fake = makeFakeAgent()
    await renderWidget(fake, 'on-failure')

    await fake.emit.runFinalized()

    const prompt = await screen.findByTestId('failure-lead-prompt')
    expect(within(prompt).getByText(/couldn.t find anything on that in our knowledge base/i)).toBeTruthy()
    expect(within(prompt).getByPlaceholderText('you@example.com')).toBeTruthy()

    const calls = leadSignalCalls()
    expect(calls.length).toBe(1)
    const body = JSON.parse((calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({
      widgetToken: TOKEN,
      renderToken: 'test-render-token',
      visitorId: expect.any(String),
    })
  })

  it('does not show the failure-lead-prompt when the signal is none', async () => {
    mockLeadSignalResponse('none')
    const fake = makeFakeAgent()
    await renderWidget(fake, 'on-failure')

    await fake.emit.runFinalized()

    expect(leadSignalCalls().length).toBe(1)
    expect(screen.queryByTestId('failure-lead-prompt')).toBeNull()
  })

  it('hides the prompt on "No thanks" and does not bring it back on a later failure', async () => {
    mockLeadSignalResponse('no-kb-match')
    const fake = makeFakeAgent()
    await renderWidget(fake, 'on-failure')

    await fake.emit.runFinalized()
    await screen.findByTestId('failure-lead-prompt')

    await userEvent.setup().click(screen.getByRole('button', { name: 'No thanks' }))
    expect(screen.queryByTestId('failure-lead-prompt')).toBeNull()

    await fake.emit.runFinalized()
    expect(screen.queryByTestId('failure-lead-prompt')).toBeNull()
  })

  it('submits the email from the prompt, posts it, and hides the prompt afterward', async () => {
    mockLeadSignalResponse('no-kb-match')
    const fake = makeFakeAgent()
    await renderWidget(fake, 'on-failure')

    await fake.emit.runFinalized()
    const prompt = await screen.findByTestId('failure-lead-prompt')

    const user = userEvent.setup()
    await user.type(within(prompt).getByPlaceholderText('you@example.com'), 'visitor@example.com')
    await user.click(within(prompt).getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.queryByTestId('failure-lead-prompt')).toBeNull())

    const calls = leadCalls()
    expect(calls.length).toBe(1)
    const body = JSON.parse((calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({
      widgetToken: TOKEN,
      renderToken: 'test-render-token',
      email: 'visitor@example.com',
    })
  })

  it("never checks or shows the failure prompt in 'off' mode", async () => {
    mockLeadSignalResponse('no-kb-match')
    const fake = makeFakeAgent()
    await renderWidget(fake, 'off')

    await fake.emit.runFinalized()

    expect(screen.queryByTestId('failure-lead-prompt')).toBeNull()
    expect(leadSignalCalls().length).toBe(0)
  })

  it('does not show the prompt, and does not crash, when the lead-signal check itself fails (network error)', async () => {
    h.fetchMock.mockImplementation(async (url: unknown) => {
      if (typeof url === 'string' && url.includes('/api/widget/lead-signal')) {
        throw new Error('network down')
      }
      return new Response(null, { status: 200 })
    })
    const fake = makeFakeAgent()
    await renderWidget(fake, 'on-failure')

    await fake.emit.runFinalized()

    expect(screen.queryByTestId('failure-lead-prompt')).toBeNull()
    // The chat itself is still usable — a failed check doesn't break anything
    // else on the page.
    expect(screen.getByPlaceholderText('Ask a question…')).toBeTruthy()
  })

  it('does not show the prompt when the lead-signal endpoint responds with an error status', async () => {
    h.fetchMock.mockImplementation(async (url: unknown) => {
      if (typeof url === 'string' && url.includes('/api/widget/lead-signal')) {
        return new Response('Too many requests', { status: 429 })
      }
      return new Response(null, { status: 200 })
    })
    const fake = makeFakeAgent()
    await renderWidget(fake, 'on-failure')

    await fake.emit.runFinalized()

    expect(screen.queryByTestId('failure-lead-prompt')).toBeNull()
  })
})

describe('WidgetChat: on-failure prompt submission failure', () => {
  it('keeps the prompt open with an error when the lead endpoint rejects the address', async () => {
    mockLeadSignalResponse('no-kb-match')
    const fake = makeFakeAgent()
    await renderWidget(fake, 'on-failure')
    await fake.emit.runFinalized()
    const prompt = await screen.findByTestId('failure-lead-prompt')

    h.fetchMock.mockImplementation(async (url: unknown) => {
      if (typeof url === 'string' && url.includes('/api/widget/lead-signal')) {
        return new Response(JSON.stringify({ signal: 'no-kb-match' }), { status: 200 })
      }
      if (typeof url === 'string' && url.includes('/api/widget/lead')) {
        return new Response('Invalid email', { status: 400 })
      }
      return new Response(null, { status: 200 })
    })

    const user = userEvent.setup()
    await user.type(within(prompt).getByPlaceholderText('you@example.com'), 'visitor@example.com')
    await user.click(within(prompt).getByRole('button', { name: 'Send' }))

    // The prompt stays visible with an error — the lead never saved and the
    // visitor can see that and retry.
    await waitFor(() => expect(screen.getByTestId('failure-lead-prompt')).toBeTruthy())
    expect(within(screen.getByTestId('failure-lead-prompt')).getByText(/didn.t go through/i)).toBeTruthy()
  })

  it('keeps the prompt open with an error when the lead request never reaches the server', async () => {
    mockLeadSignalResponse('no-kb-match')
    const fake = makeFakeAgent()
    await renderWidget(fake, 'on-failure')
    await fake.emit.runFinalized()
    const prompt = await screen.findByTestId('failure-lead-prompt')

    h.fetchMock.mockImplementation(async (url: unknown) => {
      if (typeof url === 'string' && url.includes('/api/widget/lead-signal')) {
        return new Response(JSON.stringify({ signal: 'no-kb-match' }), { status: 200 })
      }
      if (typeof url === 'string' && url.includes('/api/widget/lead')) {
        throw new Error('network down')
      }
      return new Response(null, { status: 200 })
    })

    const user = userEvent.setup()
    await user.type(within(prompt).getByPlaceholderText('you@example.com'), 'visitor@example.com')
    await user.click(within(prompt).getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.getByTestId('failure-lead-prompt')).toBeTruthy())
    expect(within(screen.getByTestId('failure-lead-prompt')).getByText(/didn.t go through/i)).toBeTruthy()
  })
})
