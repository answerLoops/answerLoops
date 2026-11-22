// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Message } from '@ag-ui/client'
import { saveTranscript } from '@/lib/widget/transcript'

/**
 * Suggested follow-up questions in the chat panel: pressable only under the
 * newest reply, gone once the visitor types or answers, and never live in a
 * conversation restored from an earlier visit. The CopilotKit runtime is faked
 * as in widget-chat-cards-integration.test.tsx, but the REAL card is rendered.
 */

type Subscriber = {
  onEvent?: (p: { messages: Message[] }) => void
  onRunInitialized?: () => void
  onRunFinalized?: () => void
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
      setMessages: vi.fn((m: Message[]) => {
        messages = m
      }),
      subscribe: vi.fn((s: Subscriber) => {
        subscriber = s
        return { unsubscribe: vi.fn() }
      }),
    },
    emit: {
      event: (msgs: Message[]) =>
        act(() => {
          messages = msgs
          subscriber?.onEvent?.({ messages: msgs })
        }),
      runInitialized: () => act(() => subscriber?.onRunInitialized?.()),
      runFinalized: () => act(() => subscriber?.onRunFinalized?.()),
    },
    addMessage,
    runAgent,
  }
}

const h = vi.hoisted(() => ({
  current: null as ReturnType<typeof makeFakeAgent> | null,
  renderToolCall: vi.fn((_: unknown): unknown => null),
}))

vi.mock('@copilotkit/react-core/v2', () => ({
  CopilotKitProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@copilotkit/react-core/v2/headless', () => ({
  useAgent: () => ({ agent: h.current!.agent, isReady: true }),
  useRenderTool: () => {},
  useRenderToolCall: () => h.renderToolCall,
}))

const TOKEN = 'a'.repeat(48)
let FollowUpsCard: typeof import('@/app/widget/[widgetToken]/genui-cards').FollowUpsCard

type RenderArg = { toolCall: { id: string; function: { name: string } }; toolMessage?: { content: string } }

/** The real FollowUpsCard for show_follow_ups once its result exists, as the panel registers it. */
function installRenderer() {
  h.renderToolCall.mockImplementation((arg: unknown) => {
    const { toolCall, toolMessage } = arg as RenderArg
    if (!toolMessage || toolCall.function.name !== 'show_follow_ups') return null
    const data = JSON.parse(toolMessage.content) as { prompt?: string; questions: { label: string }[] }
    return <FollowUpsCard key={toolCall.id} data={data} toolCallId={toolCall.id} />
  })
}

const QUESTIONS = ['How does the AI check its answers?', 'Can I run it on my own server?']

function replyWithFollowUps(opts: { msgId: string; callId: string; text?: string; questions?: string[] }): Message[] {
  return [
    {
      id: opts.msgId,
      role: 'assistant',
      content: opts.text ?? 'Here is how it works.',
      toolCalls: [{ id: opts.callId, type: 'function', function: { name: 'show_follow_ups', arguments: '{}' } }],
    },
    {
      id: `${opts.msgId}-result`,
      role: 'tool',
      toolCallId: opts.callId,
      content: JSON.stringify({ questions: (opts.questions ?? QUESTIONS).map((label) => ({ label })) }),
    },
  ] as Message[]
}

const visitor = (id: string, content: string): Message => ({ id, role: 'user', content }) as Message

async function openChat(fake: ReturnType<typeof makeFakeAgent>) {
  h.current = fake
  ;({ FollowUpsCard } = await import('@/app/widget/[widgetToken]/genui-cards'))
  const { WidgetChat } = await import('@/app/widget/[widgetToken]/widget-chat')
  render(<WidgetChat widgetToken={TOKEN} renderToken="render-tok" orgName="Acme" showBranding isSelfPreview={false} leadCaptureMode="up-front" />)
  const skip = screen.queryByRole('button', { name: 'Skip' })
  if (skip) await userEvent.setup().click(skip)
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.resetModules()
  localStorage.clear()
  sessionStorage.clear()
  h.renderToolCall.mockImplementation(() => null)
  Element.prototype.scrollIntoView = vi.fn()
  installRenderer()
})

describe('follow-up suggestions under the newest reply', () => {
  it('shows the suggested questions as buttons with the lead-in', async () => {
    const fake = makeFakeAgent()
    await openChat(fake)
    await fake.emit.event([visitor('u1', 'How does it work?'), ...replyWithFollowUps({ msgId: 'a1', callId: 't1' })])

    expect(screen.getByTestId('follow-ups')).toBeTruthy()
    expect(screen.getByText('You might also ask')).toBeTruthy()
    for (const q of QUESTIONS) expect(screen.getByRole('button', { name: q })).toBeTruthy()
  })

  it('sends the tapped question exactly as written, once, and the buttons are gone', async () => {
    const fake = makeFakeAgent()
    await openChat(fake)
    await fake.emit.event([visitor('u1', 'How does it work?'), ...replyWithFollowUps({ msgId: 'a1', callId: 't1' })])

    await userEvent.setup().click(screen.getByRole('button', { name: QUESTIONS[1] }))

    expect(fake.addMessage).toHaveBeenCalledTimes(1)
    expect(fake.addMessage).toHaveBeenCalledWith(expect.objectContaining({ role: 'user', content: QUESTIONS[1] }))
    expect(fake.runAgent).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('follow-ups')).toBeNull()
  })

  it('goes away as soon as the visitor starts typing, and comes back if they clear the box', async () => {
    const fake = makeFakeAgent()
    await openChat(fake)
    await fake.emit.event([visitor('u1', 'How does it work?'), ...replyWithFollowUps({ msgId: 'a1', callId: 't1' })])
    const user = userEvent.setup()
    const box = screen.getByPlaceholderText('Ask a question…')

    await user.type(box, 'W')
    expect(screen.queryByTestId('follow-ups')).toBeNull()
    await user.clear(box)
    expect(screen.getByTestId('follow-ups')).toBeTruthy()
  })

  it('goes away when the visitor sends their own message', async () => {
    const fake = makeFakeAgent()
    await openChat(fake)
    await fake.emit.event([visitor('u1', 'How does it work?'), ...replyWithFollowUps({ msgId: 'a1', callId: 't1' })])
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText('Ask a question…'), 'What does it cost?{Enter}')
    expect(screen.queryByTestId('follow-ups')).toBeNull()
  })

  it('is not pressable while a reply is still arriving', async () => {
    const fake = makeFakeAgent()
    await openChat(fake)
    await fake.emit.event([visitor('u1', 'How does it work?'), ...replyWithFollowUps({ msgId: 'a1', callId: 't1' })])
    await fake.emit.runInitialized()
    expect(screen.queryByTestId('follow-ups')).toBeNull()
  })

  it('only the newest reply\'s suggestions are ever shown', async () => {
    const fake = makeFakeAgent()
    await openChat(fake)
    await fake.emit.event([
      visitor('u1', 'How does it work?'),
      ...replyWithFollowUps({ msgId: 'a1', callId: 't1', questions: ['Old one?', 'Old two?'] }),
      visitor('u2', 'And the price?'),
      ...replyWithFollowUps({ msgId: 'a2', callId: 't2', text: 'It is $39.', questions: ['New one?', 'New two?'] }),
    ])

    expect(screen.getAllByTestId('follow-ups')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Old one?' })).toBeNull()
    expect(screen.getByRole('button', { name: 'New one?' })).toBeTruthy()
  })

  it('shows none when the same reply carries another card', async () => {
    const fake = makeFakeAgent()
    await openChat(fake)
    await fake.emit.event([
      visitor('u1', 'How do I set it up?'),
      {
        id: 'a1',
        role: 'assistant',
        content: 'Steps:',
        toolCalls: [
          { id: 't0', type: 'function', function: { name: 'show_steps', arguments: '{}' } },
          { id: 't1', type: 'function', function: { name: 'show_follow_ups', arguments: '{}' } },
        ],
      },
      { id: 'a1-r0', role: 'tool', toolCallId: 't0', content: '{}' },
      { id: 'a1-r1', role: 'tool', toolCallId: 't1', content: JSON.stringify({ questions: QUESTIONS.map((label) => ({ label })) }) },
    ] as Message[])

    expect(screen.queryByTestId('follow-ups')).toBeNull()
  })
})

describe('after the conversation is restored from an earlier visit', () => {
  it('shows no live suggestions, even though they are the newest in the thread', async () => {
    saveTranscript(TOKEN, [visitor('u1', 'How does it work?'), ...replyWithFollowUps({ msgId: 'a1', callId: 't1' })])
    const fake = makeFakeAgent()
    await openChat(fake)

    expect(screen.getByText('Here is how it works.')).toBeTruthy()
    expect(screen.queryByTestId('follow-ups')).toBeNull()
    for (const q of QUESTIONS) expect(screen.queryByRole('button', { name: q })).toBeNull()
  })

  it('still offers suggestions on a new reply in the restored conversation', async () => {
    saveTranscript(TOKEN, [visitor('u1', 'How does it work?'), ...replyWithFollowUps({ msgId: 'a1', callId: 't1' })])
    const fake = makeFakeAgent()
    await openChat(fake)
    await fake.emit.event([
      visitor('u1', 'How does it work?'),
      ...replyWithFollowUps({ msgId: 'a1', callId: 't1' }),
      visitor('u2', 'And the price?'),
      ...replyWithFollowUps({ msgId: 'a2', callId: 't2', text: 'It is $39.', questions: ['Annual billing?', 'Is there a trial?'] }),
    ])

    expect(screen.getAllByTestId('follow-ups')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Is there a trial?' })).toBeTruthy()
  })
})
