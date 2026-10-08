// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Message } from '@ag-ui/client'

/**
 * WidgetChat and the real rich cards working together. The CopilotKit hooks
 * are faked (as in widget-chat-component.test.tsx), but `useRenderToolCall`
 * renders the REAL ChoicesCard so the WidgetActionsProvider wiring, the
 * memoised MessageRow, the tool-result map and the scroll rule are exercised
 * through the component rather than in isolation.
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
    emit: {
      // Keep the agent's own list in step with what it reports, as the real
      // agent does — sendMessage re-reads agent.messages after addMessage.
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
const scrollIntoView = vi.fn()
// vi.resetModules() gives WidgetChat a fresh genui-cards module (and so a fresh
// WidgetActionsContext) each test, so the card must come from that same
// instance or it would read the context's default (canReply: false).
let ChoicesCard: typeof import('@/app/widget/[widgetToken]/genui-cards').ChoicesCard

type RenderArg = { toolCall: { id: string; function: { name: string } }; toolMessage?: { content: string } }

/** Real ChoicesCard for show_choices once its result exists; skeleton-less nothing before. */
function installChoicesRenderer() {
  h.renderToolCall.mockImplementation((arg: unknown) => {
    const { toolCall, toolMessage } = arg as RenderArg
    if (!toolMessage) return null
    const data = JSON.parse(toolMessage.content) as { prompt: string; options: { label: string }[] }
    return <ChoicesCard key={toolCall.id} data={data} />
  })
}

function choicesThread(opts: { callId: string; msgId: string; prompt: string; labels: string[] }): Message[] {
  return [
    {
      id: opts.msgId,
      role: 'assistant',
      content: '',
      toolCalls: [{ id: opts.callId, type: 'function', function: { name: 'show_choices', arguments: '{}' } }],
    },
    {
      id: `${opts.msgId}-result`,
      role: 'tool',
      toolCallId: opts.callId,
      content: JSON.stringify({ prompt: opts.prompt, options: opts.labels.map((label) => ({ label })) }),
    },
  ] as Message[]
}

async function openThread(fake: ReturnType<typeof makeFakeAgent>) {
  h.current = fake
  ;({ ChoicesCard } = await import('@/app/widget/[widgetToken]/genui-cards'))
  const { WidgetChat } = await import('@/app/widget/[widgetToken]/widget-chat')
  render(<WidgetChat widgetToken={TOKEN} renderToken="render-tok" orgName="Acme" showBranding isSelfPreview={false} />)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Skip' }))
}

function callsFor(toolCallId: string, withResult?: boolean) {
  return h.renderToolCall.mock.calls.filter(([arg]) => {
    const a = arg as RenderArg
    if (a.toolCall.id !== toolCallId) return false
    return withResult === undefined ? true : (a.toolMessage !== undefined) === withResult
  }).length
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  localStorage.clear()
  h.renderToolCall.mockImplementation(() => null)
  scrollIntoView.mockClear()
  Element.prototype.scrollIntoView = scrollIntoView
})

describe('WidgetChat + ChoicesCard: replying through a card', () => {
  it('sends the tapped label as a user message with the full forwardedProps, then locks the card', async () => {
    installChoicesRenderer()
    const fake = makeFakeAgent()
    await openThread(fake)
    await fake.emit.event(choicesThread({ callId: 'tc1', msgId: 'a1', prompt: 'Which plan?', labels: ['Starter', 'Pro'] }))

    await userEvent.setup().click(screen.getByRole('button', { name: 'Pro' }))

    expect(fake.addMessage).toHaveBeenCalledTimes(1)
    expect(fake.addMessage).toHaveBeenCalledWith(expect.objectContaining({ role: 'user', content: 'Pro' }))
    expect(fake.runAgent).toHaveBeenCalledTimes(1)
    const runArg = (fake.runAgent.mock.calls[0] as unknown[])[0] as {
      forwardedProps: Record<string, unknown>
    }
    expect(runArg.forwardedProps).toEqual({
      widgetToken: TOKEN,
      renderToken: 'render-tok',
      visitorId: expect.any(String),
      isSelfPreview: false,
    })
    expect((runArg.forwardedProps.visitorId as string).length).toBeGreaterThan(0)

    // The visitor's own bubble shows immediately and every option is locked.
    for (const label of ['Starter', 'Pro']) {
      const btn = screen.getAllByRole('button', { name: label }).find((b) => b.closest('section'))!
      expect((btn as HTMLButtonElement).disabled).toBe(true)
    }
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Starter' })[0])
    expect(fake.addMessage).toHaveBeenCalledTimes(1)
  })

  it('is inert while a run is in progress, and a new unpicked card is usable after the run finishes', async () => {
    installChoicesRenderer()
    const fake = makeFakeAgent()
    await openThread(fake)
    const first = choicesThread({ callId: 'tc1', msgId: 'a1', prompt: 'First?', labels: ['One', 'Two'] })
    await fake.emit.event(first)

    await fake.emit.runInitialized()
    const user = userEvent.setup()
    const oneBtn = screen.getByRole('button', { name: 'One' }) as HTMLButtonElement
    expect(oneBtn.disabled).toBe(true)
    await user.click(oneBtn)
    expect(fake.addMessage).not.toHaveBeenCalled()
    expect(fake.runAgent).not.toHaveBeenCalled()

    // Run ends with a second, fresh card.
    await fake.emit.event([...first, ...choicesThread({ callId: 'tc2', msgId: 'a2', prompt: 'Second?', labels: ['Red', 'Blue'] })])
    await fake.emit.runFinalized()

    const blue = screen.getByRole('button', { name: 'Blue' }) as HTMLButtonElement
    expect(blue.disabled).toBe(false)
    await user.click(blue)
    expect(fake.addMessage).toHaveBeenCalledWith(expect.objectContaining({ role: 'user', content: 'Blue' }))
    expect(fake.runAgent).toHaveBeenCalledTimes(1)
  })

  it('ignores a card tap while loading even for an already-rendered, never-picked card', async () => {
    installChoicesRenderer()
    const fake = makeFakeAgent()
    await openThread(fake)
    await fake.emit.event(choicesThread({ callId: 'tc1', msgId: 'a1', prompt: 'Q?', labels: ['Yes', 'No'] }))
    expect((screen.getByRole('button', { name: 'Yes' }) as HTMLButtonElement).disabled).toBe(false)

    await fake.emit.runInitialized()
    expect((screen.getByRole('button', { name: 'Yes' }) as HTMLButtonElement).disabled).toBe(true)

    await fake.emit.runFinalized()
    expect((screen.getByRole('button', { name: 'Yes' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('does not send a whitespace-only choice label', async () => {
    // A renderer that hands the actions a blank label would reach sendMessage
    // via the context; the trim guard must swallow it.
    h.renderToolCall.mockImplementation((arg: unknown) => {
      const { toolMessage } = arg as RenderArg
      if (!toolMessage) return null
      return <ChoicesCard data={{ prompt: 'Blank?', options: [{ label: '   ' }, { label: 'Real' }] }} />
    })
    const fake = makeFakeAgent()
    await openThread(fake)
    await fake.emit.event(choicesThread({ callId: 'tc1', msgId: 'a1', prompt: 'x', labels: ['x', 'y'] }))

    const blank = screen.getAllByRole('button').find((b) => b.textContent === '   ')!
    await userEvent.setup().click(blank)

    expect(fake.addMessage).not.toHaveBeenCalled()
    expect(fake.runAgent).not.toHaveBeenCalled()
  })
})

describe('WidgetChat: MessageRow memoisation', () => {
  const user: Message = { id: 'u1', role: 'user', content: 'q' } as Message
  const assistantWithCall = (content = ''): Message =>
    ({
      id: 'a1',
      role: 'assistant',
      content,
      toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'show_steps', arguments: '{"a":1}' } }],
    }) as Message
  const result = (content: string): Message => ({ id: 't1', role: 'tool', toolCallId: 'tc1', content }) as Message

  it('does not re-render an earlier unchanged assistant row when a later message streams in', async () => {
    h.renderToolCall.mockImplementation(() => <div data-testid="card">card</div>)
    const fake = makeFakeAgent()
    await openThread(fake)
    await fake.emit.event([user, assistantWithCall(), result('{"ok":true}')])
    const baseline = callsFor('tc1')
    expect(baseline).toBeGreaterThan(0)

    // Fresh object identities with identical content, as the agent produces per event.
    const streaming = (text: string) => ({ id: 'a2', role: 'assistant', content: text }) as Message
    await fake.emit.event([{ ...user } as Message, assistantWithCall(), result('{"ok":true}'), streaming('Hel')])
    await fake.emit.event([{ ...user } as Message, assistantWithCall(), result('{"ok":true}'), streaming('Hello wor')])

    expect(screen.getByText('Hello wor')).toBeTruthy()
    expect(callsFor('tc1')).toBe(baseline)
  })

  it('re-renders that row when its tool result content changes', async () => {
    h.renderToolCall.mockImplementation(() => <div data-testid="card">card</div>)
    const fake = makeFakeAgent()
    await openThread(fake)
    await fake.emit.event([user, assistantWithCall()])
    expect(callsFor('tc1', true)).toBe(0)
    const before = callsFor('tc1')

    await fake.emit.event([user, assistantWithCall(), result('{"v":1}')])
    expect(callsFor('tc1')).toBeGreaterThan(before)
    expect(callsFor('tc1', true)).toBeGreaterThan(0)

    const afterFirstResult = callsFor('tc1')
    await fake.emit.event([user, assistantWithCall(), result('{"v":2}')])
    expect(callsFor('tc1')).toBeGreaterThan(afterFirstResult)
    const lastArg = h.renderToolCall.mock.calls.at(-1)![0] as RenderArg
    expect(lastArg.toolMessage?.content).toBe('{"v":2}')
  })

  it('re-renders the row when its own text changes', async () => {
    h.renderToolCall.mockImplementation(() => null)
    const fake = makeFakeAgent()
    await openThread(fake)
    await fake.emit.event([user, assistantWithCall('Part')])
    const before = callsFor('tc1')
    await fake.emit.event([user, assistantWithCall('Part two')])
    expect(callsFor('tc1')).toBeGreaterThan(before)
    expect(screen.getByText('Part two')).toBeTruthy()
  })
})

describe('WidgetChat: tool-result mapping', () => {
  it('hands each tool result only to the assistant message whose tool call it answers', async () => {
    h.renderToolCall.mockImplementation((arg: unknown) => {
      const { toolCall, toolMessage } = arg as RenderArg
      return <div data-testid={`card-${toolCall.id}`}>{toolMessage?.content ?? 'pending'}</div>
    })
    const call = (id: string) => ({ id, type: 'function', function: { name: 'show_steps', arguments: '{}' } })
    const fake = makeFakeAgent()
    await openThread(fake)
    await fake.emit.event([
      { id: 'u1', role: 'user', content: 'q' },
      { id: 'a1', role: 'assistant', content: '', toolCalls: [call('tcA')] },
      { id: 'a2', role: 'assistant', content: '', toolCalls: [call('tcB')] },
      // Results arrive in the opposite order to the calls.
      { id: 't2', role: 'tool', toolCallId: 'tcB', content: 'RESULT-B' },
      { id: 't1', role: 'tool', toolCallId: 'tcA', content: 'RESULT-A' },
    ] as Message[])

    expect(screen.getByTestId('card-tcA').textContent).toBe('RESULT-A')
    expect(screen.getByTestId('card-tcB').textContent).toBe('RESULT-B')
  })

  it('leaves a call pending when only another call has a result', async () => {
    h.renderToolCall.mockImplementation((arg: unknown) => {
      const { toolCall, toolMessage } = arg as RenderArg
      return <div data-testid={`card-${toolCall.id}`}>{toolMessage?.content ?? 'pending'}</div>
    })
    const call = (id: string) => ({ id, type: 'function', function: { name: 'show_steps', arguments: '{}' } })
    const fake = makeFakeAgent()
    await openThread(fake)
    await fake.emit.event([
      { id: 'a1', role: 'assistant', content: '', toolCalls: [call('tcA')] },
      { id: 'a2', role: 'assistant', content: '', toolCalls: [call('tcB')] },
      { id: 't1', role: 'tool', toolCallId: 'tcA', content: 'RESULT-A' },
    ] as Message[])

    expect(screen.getByTestId('card-tcA').textContent).toBe('RESULT-A')
    expect(screen.getByTestId('card-tcB').textContent).toBe('pending')
  })
})

describe('WidgetChat: rows that draw nothing', () => {
  it('never draws a bubble for tool or system messages', async () => {
    const fake = makeFakeAgent()
    await openThread(fake)
    await fake.emit.event([
      { id: 's1', role: 'system', content: 'SYSTEM-PROMPT-TEXT' },
      { id: 'u1', role: 'user', content: 'hi' },
      { id: 't1', role: 'tool', toolCallId: 'orphan', content: 'ORPHAN-TOOL-TEXT' },
    ] as Message[])

    expect(screen.getByText('hi')).toBeTruthy()
    expect(screen.queryByText('SYSTEM-PROMPT-TEXT')).toBeNull()
    expect(screen.queryByText('ORPHAN-TOOL-TEXT')).toBeNull()
    expect(document.querySelectorAll('.bg-gray-100').length).toBe(0)
  })

  it('renders nothing for a whitespace-less empty assistant message and for one whose card is null', async () => {
    h.renderToolCall.mockImplementation(() => null)
    const fake = makeFakeAgent()
    await openThread(fake)
    await fake.emit.event([
      { id: 'u1', role: 'user', content: 'q' },
      { id: 'a1', role: 'assistant', content: '' },
      {
        id: 'a2',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'show_steps', arguments: '{}' } }],
      },
    ] as Message[])

    expect(document.querySelectorAll('.bg-gray-100').length).toBe(0)
    expect(document.querySelectorAll('.pl-8').length).toBe(0)
  })
})

describe('WidgetChat: scroll behaviour', () => {
  it('scrolls smoothly when idle', async () => {
    const fake = makeFakeAgent()
    await openThread(fake)
    await fake.emit.event([{ id: 'u1', role: 'user', content: 'q' }] as Message[])

    expect(scrollIntoView).toHaveBeenCalled()
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth' })
  })

  it('jumps (auto) while a run is loading and returns to smooth once it finishes', async () => {
    const fake = makeFakeAgent()
    await openThread(fake)

    await fake.emit.runInitialized()
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto' })

    scrollIntoView.mockClear()
    await fake.emit.event([
      { id: 'u1', role: 'user', content: 'q' },
      { id: 'a1', role: 'assistant', content: 'Streaming…' },
    ] as Message[])
    expect(scrollIntoView).toHaveBeenCalled()
    for (const [arg] of scrollIntoView.mock.calls) expect(arg).toEqual({ behavior: 'auto' })

    await fake.emit.runFinalized()
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth' })
  })
})
