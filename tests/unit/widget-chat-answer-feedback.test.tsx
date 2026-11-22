// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Message } from '@ag-ui/client'

/**
 * WidgetChat with `answerFlagsEnabled`: after each turn the widget asks the
 * server for a signed reference to the answer just given (the same post-turn
 * call the on-failure prompt uses) and, when it gets one, shows the thumbs under
 * that reply. With flagging off nothing about the widget changes. The agent is
 * faked the same way as in widget-chat-lead-capture.test.tsx.
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
  return {
    agent: {
      get messages() {
        return messages
      },
      addMessage,
      runAgent: vi.fn(async () => {}),
      subscribe: vi.fn((s: Subscriber) => {
        subscriber = s
        return { unsubscribe: vi.fn() }
      }),
    },
    emit: {
      runFinalized: () =>
        act(async () => {
          subscriber?.onRunFinalized?.()
          await new Promise((resolve) => setTimeout(resolve, 0))
        }),
    },
  }
}

const h = vi.hoisted(() => ({
  current: null as ReturnType<typeof makeFakeAgent> | null,
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
const reply: Message = { id: 'a1', role: 'assistant', content: 'Open Settings and choose Export.' }

type Mode = 'off' | 'on-failure' | 'up-front'

async function renderWidget(fake: ReturnType<typeof makeFakeAgent>, mode: Mode, answerFlagsEnabled?: boolean) {
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
      {...(answerFlagsEnabled === undefined ? {} : { answerFlagsEnabled })}
    />
  )
}

/** Answers the post-turn lookup, and the flag endpoint, the way the real routes do. */
function mockServer(lookup: Record<string, unknown>) {
  h.fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
    if (url === '/api/widget/lead-signal') return new Response(JSON.stringify(lookup), { status: 200 })
    if (url === '/api/widget/flag') {
      return new Response(JSON.stringify(init?.method === 'POST' ? { ok: true, flagToken: 'flag-token' } : { ok: true }), {
        status: 200,
      })
    }
    return new Response(null, { status: 200 })
  })
}

const callsTo = (path: string) => h.fetchMock.mock.calls.filter(([url]) => url === path)

async function sendQuestion(text = 'how do I export my data?') {
  await userEvent.setup().type(screen.getByPlaceholderText('Ask a question…'), `${text}{Enter}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  localStorage.clear()
  mockServer({ signal: 'none' })
})

describe('WidgetChat: answer thumbs are off by default', () => {
  it('makes no post-turn request and shows no thumbs when flagging is not enabled', async () => {
    const fake = makeFakeAgent([reply])
    await renderWidget(fake, 'off')
    await sendQuestion()
    await fake.emit.runFinalized()
    expect(callsTo('/api/widget/lead-signal')).toHaveLength(0)
    expect(screen.queryByTestId('answer-feedback')).toBeNull()
  })

  it('still makes only the on-failure request, and shows no thumbs, in on-failure mode', async () => {
    mockServer({ signal: 'none', answerToken: 'tok-1' })
    const fake = makeFakeAgent([reply])
    await renderWidget(fake, 'on-failure')
    await sendQuestion()
    await fake.emit.runFinalized()
    expect(callsTo('/api/widget/lead-signal')).toHaveLength(1)
    expect(screen.queryByTestId('answer-feedback')).toBeNull()
  })
})

describe('WidgetChat: answer thumbs when flagging is enabled', () => {
  it('asks for the answer reference after the turn, even with email follow-up off, and shows the thumbs under the reply', async () => {
    mockServer({ signal: 'none', answerToken: 'tok-1' })
    const fake = makeFakeAgent([reply])
    await renderWidget(fake, 'off', true)
    await sendQuestion()
    await fake.emit.runFinalized()

    const calls = callsTo('/api/widget/lead-signal')
    expect(calls).toHaveLength(1)
    expect(JSON.parse((calls[0][1] as RequestInit).body as string)).toEqual({
      widgetToken: TOKEN,
      renderToken: 'test-render-token',
      visitorId: expect.any(String),
      turnId: expect.any(String),
    })
    expect(await screen.findByTestId('answer-feedback')).toBeTruthy()
    expect(screen.queryByTestId('failure-lead-prompt')).toBeNull()
  })

  it('shows no thumbs when the server returned no reference for the turn', async () => {
    mockServer({ signal: 'none' })
    const fake = makeFakeAgent([reply])
    await renderWidget(fake, 'off', true)
    await sendQuestion()
    await fake.emit.runFinalized()
    expect(screen.queryByTestId('answer-feedback')).toBeNull()
  })

  it('shows no thumbs when the lookup fails', async () => {
    h.fetchMock.mockImplementation(async () => new Response('x', { status: 500 }))
    const fake = makeFakeAgent([reply])
    await renderWidget(fake, 'off', true)
    await sendQuestion()
    await fake.emit.runFinalized()
    expect(screen.queryByTestId('answer-feedback')).toBeNull()
  })

  it('shows the on-failure prompt and the thumbs together when a turn has both', async () => {
    mockServer({ signal: 'no-kb-match', questionToken: 'q-tok', answerToken: 'tok-1' })
    const fake = makeFakeAgent([reply])
    await renderWidget(fake, 'on-failure', true)
    await sendQuestion()
    await fake.emit.runFinalized()
    expect(await screen.findByTestId('failure-lead-prompt')).toBeTruthy()
    expect(await screen.findByTestId('answer-feedback')).toBeTruthy()
    expect(callsTo('/api/widget/lead-signal')).toHaveLength(1)
  })

  it('does not show the on-failure prompt in off mode even though it makes the same request', async () => {
    mockServer({ signal: 'no-kb-match', questionToken: 'q-tok', answerToken: 'tok-1' })
    const fake = makeFakeAgent([reply])
    await renderWidget(fake, 'off', true)
    await sendQuestion()
    await fake.emit.runFinalized()
    expect(screen.queryByTestId('failure-lead-prompt')).toBeNull()
    expect(await screen.findByTestId('answer-feedback')).toBeTruthy()
  })

  it('keeps asking for the reference after the visitor has dismissed the on-failure prompt', async () => {
    mockServer({ signal: 'no-kb-match', questionToken: 'q-tok', answerToken: 'tok-1' })
    const fake = makeFakeAgent([reply])
    await renderWidget(fake, 'on-failure', true)
    await sendQuestion()
    await fake.emit.runFinalized()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'No thanks' }))
    await fake.emit.runFinalized()
    expect(callsTo('/api/widget/lead-signal')).toHaveLength(2)
    expect(screen.queryByTestId('failure-lead-prompt')).toBeNull()
  })

  it('shows no thumbs under an earlier reply that was never given a reference (for example one restored from an earlier visit)', async () => {
    mockServer({ signal: 'none', answerToken: 'tok-new' })
    const earlier: Message = { id: 'a0', role: 'assistant', content: 'An earlier answer.' }
    const fake = makeFakeAgent([earlier])
    await renderWidget(fake, 'off', true)
    // The turn that is finishing produced a different, newer reply.
    fake.agent.addMessage({ id: 'u1', role: 'user', content: 'q' })
    fake.agent.addMessage(reply)
    await sendQuestion()
    await fake.emit.runFinalized()
    expect(screen.getAllByTestId('answer-feedback')).toHaveLength(1)
  })

  it('a thumbs-down posts the reference the server gave, then offers the email field only when email follow-up is on', async () => {
    mockServer({ signal: 'none', answerToken: 'tok-1' })
    const fake = makeFakeAgent([reply])
    await renderWidget(fake, 'on-failure', true)
    await sendQuestion()
    await fake.emit.runFinalized()

    const user = userEvent.setup()
    await user.click(await screen.findByTestId('feedback-down'))
    const panel = await screen.findByTestId('answer-feedback-panel')
    expect(within(panel).getByPlaceholderText('you@example.com')).toBeTruthy()
    const [, init] = callsTo('/api/widget/flag')[0]
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      widgetToken: TOKEN,
      renderToken: 'test-render-token',
      verdict: 'down',
      answerToken: 'tok-1',
    })
  })

  it('offers no email field in the panel when email follow-up is off', async () => {
    mockServer({ signal: 'none', answerToken: 'tok-1' })
    const fake = makeFakeAgent([reply])
    await renderWidget(fake, 'off', true)
    await sendQuestion()
    await fake.emit.runFinalized()
    await userEvent.setup().click(await screen.findByTestId('feedback-down'))
    const panel = await screen.findByTestId('answer-feedback-panel')
    expect(within(panel).queryByPlaceholderText('you@example.com')).toBeNull()
  })
})
