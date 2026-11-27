// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Message } from '@ag-ui/client'

/**
 * Where the Copy action appears in the widget conversation: under each
 * completed assistant text reply, never under a reply still arriving, a
 * card-only message, or the visitor's own question. The agent is faked the same
 * way as in widget-chat-cards-integration.test.tsx.
 */

type Subscriber = {
  onEvent?: (p: { messages: Message[] }) => void
  onRunInitialized?: () => void
  onRunFinalized?: () => void
}

function makeFakeAgent(initialMessages: Message[] = []) {
  let messages = initialMessages
  let subscriber: Subscriber | undefined
  return {
    agent: {
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
  }
}

const h = vi.hoisted(() => ({
  current: null as ReturnType<typeof makeFakeAgent> | null,
  renderToolCall: vi.fn((_: unknown): unknown => null),
}))

vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
vi.mock('@copilotkit/react-core/v2', () => ({
  CopilotKitProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@copilotkit/react-core/v2/headless', () => ({
  useAgent: () => ({ agent: h.current!.agent, isReady: true }),
  useRenderTool: () => {},
  useRenderToolCall: () => h.renderToolCall,
}))

const TOKEN = 'a'.repeat(48)

async function renderWidget(fake: ReturnType<typeof makeFakeAgent>) {
  h.current = fake
  const { WidgetChat } = await import('@/app/widget/[widgetToken]/widget-chat')
  return render(
    <WidgetChat widgetToken={TOKEN} renderToken="test-render-token" orgName="Acme" showBranding isSelfPreview={false} leadCaptureMode="off" />
  )
}

const copyButtons = () => screen.queryAllByRole('button', { name: 'Copy reply' })

async function ask(text = 'how do I export my data?') {
  await userEvent.setup().type(screen.getByPlaceholderText('Ask a question…'), `${text}{Enter}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  h.renderToolCall.mockImplementation(() => null)
})

describe('WidgetChat: Copy on assistant replies', () => {
  it('shows Copy under a reply only once it has finished arriving', async () => {
    const fake = makeFakeAgent()
    await renderWidget(fake)
    await ask()
    const question: Message = { id: 'u1', role: 'user', content: 'how do I export my data?' }

    await fake.emit.runInitialized()
    await fake.emit.event([question, { id: 'a1', role: 'assistant', content: 'Open Settings' }])
    expect(screen.getByText('Open Settings')).toBeInTheDocument()
    expect(copyButtons()).toHaveLength(0)

    await fake.emit.event([question, { id: 'a1', role: 'assistant', content: 'Open Settings and choose Export.' }])
    expect(copyButtons()).toHaveLength(0)

    await fake.emit.runFinalized()
    expect(copyButtons()).toHaveLength(1)
  })

  it('keeps Copy on earlier replies while the next one is arriving', async () => {
    const earlier: Message[] = [
      { id: 'u0', role: 'user', content: 'first question' },
      { id: 'a0', role: 'assistant', content: 'First answer.' },
    ]
    const fake = makeFakeAgent()
    await renderWidget(fake)
    await ask('first question')
    await fake.emit.runInitialized()
    await fake.emit.event(earlier)
    await fake.emit.runFinalized()
    expect(copyButtons()).toHaveLength(1)

    await ask('second question')
    await fake.emit.runInitialized()
    await fake.emit.event([...earlier, { id: 'u1', role: 'user', content: 'second question' }, { id: 'a1', role: 'assistant', content: 'Sec' }])
    // The first reply keeps its Copy; the one arriving has none yet.
    expect(copyButtons()).toHaveLength(1)
    const firstRow = screen.getByText('First answer.').closest('.group') as HTMLElement
    expect(within(firstRow).getByRole('button', { name: 'Copy reply' })).toBeInTheDocument()
  })

  it('never puts Copy under the visitor’s own question', async () => {
    const fake = makeFakeAgent()
    await renderWidget(fake)
    await ask('my question here')
    await fake.emit.runInitialized()
    await fake.emit.event([{ id: 'u1', role: 'user', content: 'my question here' }])
    await fake.emit.runFinalized()
    expect(screen.getByText('my question here')).toBeInTheDocument()
    expect(copyButtons()).toHaveLength(0)
  })

  it('shows no Copy on a message that is only a card', async () => {
    h.renderToolCall.mockImplementation((arg: unknown) => {
      const { toolCall } = arg as { toolCall: { id: string } }
      return <div data-testid={`card-${toolCall.id}`}>A steps card</div>
    })
    const cardOnly: Message = {
      id: 'a1',
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'show_steps', arguments: '{}' } }],
    } as Message
    const fake = makeFakeAgent()
    await renderWidget(fake)
    await ask()
    await fake.emit.runInitialized()
    await fake.emit.event([{ id: 'u1', role: 'user', content: 'how do I export my data?' }, cardOnly])
    await fake.emit.runFinalized()
    expect(screen.getByTestId('card-call-1')).toBeInTheDocument()
    expect(copyButtons()).toHaveLength(0)
  })

  it('puts Copy on the reply text and leaves the card under it out of the copy', async () => {
    h.renderToolCall.mockImplementation(() => <div>Card text that must not be copied</div>)
    const withCard: Message = {
      id: 'a1',
      role: 'assistant',
      content: 'Here are the steps.',
      toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'show_steps', arguments: '{}' } }],
    } as Message
    const fake = makeFakeAgent()
    await renderWidget(fake)
    await ask()
    await fake.emit.runInitialized()
    await fake.emit.event([{ id: 'u1', role: 'user', content: 'how do I export my data?' }, withCard])
    await fake.emit.runFinalized()

    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    expect(copyButtons()).toHaveLength(1)
    await user.click(copyButtons()[0])
    expect(writeText).toHaveBeenCalledWith('Here are the steps.')
  })
})
