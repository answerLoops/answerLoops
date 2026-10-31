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
    // A network error is retried (see the "checkLeadSignal retry logic" suite
    // below) — drain the full retry budget here so no pending retry timer
    // fires into a later test once this one has already returned.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
    })

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
    // A 429 is retried (see the "checkLeadSignal retry logic" suite below) —
    // drain the full retry budget here so no pending retry timer fires into
    // a later test once this one has already returned.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
    })

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

  it('keeps the prompt open with a rate-limit-specific message when the lead endpoint responds 429', async () => {
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
        return new Response('Too many requests', { status: 429 })
      }
      return new Response(null, { status: 200 })
    })

    const user = userEvent.setup()
    await user.type(within(prompt).getByPlaceholderText('you@example.com'), 'visitor@example.com')
    await user.click(within(prompt).getByRole('button', { name: 'Send' }))

    // Distinct copy from the generic failure above — a rate limit is
    // something waiting fixes, unlike a bad address, and the visitor should
    // see that rather than the generic "didn't go through" message.
    await waitFor(() => expect(screen.getByTestId('failure-lead-prompt')).toBeTruthy())
    expect(within(screen.getByTestId('failure-lead-prompt')).getByText(/one too many tries/i)).toBeTruthy()
  })
})

describe('WidgetChat: sendMessage clears a stale failure prompt', () => {
  it('hides the failure prompt the instant a new message is sent, without marking the lead as handled', async () => {
    mockLeadSignalResponse('no-kb-match')
    const fake = makeFakeAgent()
    await renderWidget(fake, 'on-failure')

    await fake.emit.runFinalized()
    await screen.findByTestId('failure-lead-prompt')

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('Ask a question…'), 'another question{Enter}')

    // Cleared the moment the new message is sent — before any response for
    // this new turn could possibly have arrived.
    expect(screen.queryByTestId('failure-lead-prompt')).toBeNull()

    // leadHandled must still be false: if clearing the stale prompt had also
    // marked the lead as handled, checkLeadSignal would bail out early and a
    // genuine failure on this new turn could never show a fresh prompt.
    await fake.emit.runFinalized()
    expect(await screen.findByTestId('failure-lead-prompt')).toBeTruthy()
  })
})

describe('WidgetChat: checkLeadSignal retry logic', () => {
  it('clears an existing failure prompt when a later check resolves to a definitive none', async () => {
    mockLeadSignalResponse('no-kb-match')
    const fake = makeFakeAgent()
    await renderWidget(fake, 'on-failure')
    await fake.emit.runFinalized()
    await screen.findByTestId('failure-lead-prompt')

    mockLeadSignalResponse('none')
    await fake.emit.runFinalized()

    expect(screen.queryByTestId('failure-lead-prompt')).toBeNull()
  })

  it('recovers from a network error on the first attempt and shows the prompt once the retry succeeds', async () => {
    let call = 0
    h.fetchMock.mockImplementation(async (url: unknown) => {
      if (typeof url === 'string' && url.includes('/api/widget/lead-signal')) {
        call++
        if (call === 1) throw new Error('network down')
        return new Response(JSON.stringify({ signal: 'no-kb-match' }), { status: 200 })
      }
      return new Response(null, { status: 200 })
    })
    const fake = makeFakeAgent()
    await renderWidget(fake, 'on-failure')

    await fake.emit.runFinalized()
    // The retry waits LEAD_SIGNAL_RETRY_DELAY_MS (400ms) before the second
    // attempt; give it real time to land, wrapped in act() since it resolves
    // and updates state well after runFinalized's own tiny flush returns.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700))
    })

    expect(leadSignalCalls().length).toBe(2)
    expect(screen.getByTestId('failure-lead-prompt')).toBeTruthy()
  })

  it('retries 3 times then gives up quietly, showing nothing, when every attempt network-errors', async () => {
    h.fetchMock.mockImplementation(async (url: unknown) => {
      if (typeof url === 'string' && url.includes('/api/widget/lead-signal')) {
        throw new Error('network down')
      }
      return new Response(null, { status: 200 })
    })
    const fake = makeFakeAgent()
    await renderWidget(fake, 'on-failure')

    await fake.emit.runFinalized()
    // 3 attempts with 400ms then 800ms delays between them: give it real
    // time to exhaust the retry budget, wrapped in act().
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
    })

    expect(leadSignalCalls().length).toBe(3)
    expect(screen.queryByTestId('failure-lead-prompt')).toBeNull()
  })

  it('leaves an existing failure prompt showing when every retry attempt comes back rate-limited', async () => {
    mockLeadSignalResponse('no-kb-match')
    const fake = makeFakeAgent()
    await renderWidget(fake, 'on-failure')
    await fake.emit.runFinalized()
    await screen.findByTestId('failure-lead-prompt')

    h.fetchMock.mockClear()
    h.fetchMock.mockImplementation(async (url: unknown) => {
      if (typeof url === 'string' && url.includes('/api/widget/lead-signal')) {
        return new Response('Too many requests', { status: 429 })
      }
      return new Response(null, { status: 200 })
    })

    await fake.emit.runFinalized()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
    })

    // An indefinite result (retries exhausted) must never overwrite a prompt
    // that's already showing from an earlier, real signal.
    expect(leadSignalCalls().length).toBe(3)
    expect(screen.getByTestId('failure-lead-prompt')).toBeTruthy()
  })
})

describe('WidgetChat: postLead outcomes at the up-front gate', () => {
  it('stays gated and shows the address error when the lead endpoint rejects with a non-429 error', async () => {
    h.fetchMock.mockImplementation(async (url: unknown) => {
      if (typeof url === 'string' && url.includes('/api/widget/lead')) {
        return new Response('Invalid email', { status: 400 })
      }
      return new Response(null, { status: 200 })
    })
    const fake = makeFakeAgent()
    await renderWidget(fake, 'up-front')

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('you@example.com'), 'visitor@example.com')
    await user.click(screen.getByRole('button', { name: 'Start chat' }))

    await waitFor(() => expect(screen.getByText(/check the address and try again/i)).toBeTruthy())
    expect(screen.queryByPlaceholderText('Ask a question…')).toBeNull()
  })

  it('lets the visitor into the chat when the lead endpoint rate-limits the up-front submission', async () => {
    h.fetchMock.mockImplementation(async (url: unknown) => {
      if (typeof url === 'string' && url.includes('/api/widget/lead')) {
        return new Response('Too many requests', { status: 429 })
      }
      return new Response(null, { status: 200 })
    })
    const fake = makeFakeAgent()
    await renderWidget(fake, 'up-front')

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('you@example.com'), 'visitor@example.com')
    await user.click(screen.getByRole('button', { name: 'Start chat' }))

    await waitFor(() => expect(screen.getByPlaceholderText('Ask a question…')).toBeTruthy())
  })

  it('sends the up-front gate email with no question field, since no conversation has happened yet', async () => {
    const fake = makeFakeAgent()
    await renderWidget(fake, 'up-front')

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('you@example.com'), 'visitor@example.com')
    await user.click(screen.getByRole('button', { name: 'Start chat' }))

    await waitFor(() => expect(leadCalls().length).toBe(1))
    const body = JSON.parse((leadCalls()[0][1] as RequestInit).body as string)
    expect(body).not.toHaveProperty('question')
  })
})

describe('WidgetChat: failure prompt sends the visitor\'s last question', () => {
  it('includes the question field in the lead POST body, matching the last message the visitor typed', async () => {
    mockLeadSignalResponse('no-kb-match')
    const fake = makeFakeAgent()
    await renderWidget(fake, 'on-failure')

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('Ask a question…'), 'how do I reset my password?{Enter}')

    await fake.emit.runFinalized()
    const prompt = await screen.findByTestId('failure-lead-prompt')

    await user.type(within(prompt).getByPlaceholderText('you@example.com'), 'visitor@example.com')
    await user.click(within(prompt).getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(leadCalls().length).toBe(1))
    const body = JSON.parse((leadCalls()[0][1] as RequestInit).body as string)
    expect(body.question).toBe('how do I reset my password?')
  })
})
