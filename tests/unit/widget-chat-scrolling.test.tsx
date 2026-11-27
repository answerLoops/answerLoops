// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Message } from '@ag-ui/client'
import { CardSkeleton } from '@/app/widget/[widgetToken]/genui-cards'

/**
 * Scrolling and the typing indicator in the real WidgetChat: "Jump to latest"
 * appears over the conversation when a reply arrives while the visitor is
 * scrolled up, sending brings the view down, the dots fade instead of bounce
 * and sit still with reduced motion, and card placeholders do too. The agent
 * is faked as in widget-chat-cards-integration.test.tsx.
 */

type Subscriber = {
  onEvent?: (p: { messages: Message[] }) => void
  onRunInitialized?: () => void
  onRunFinalized?: () => void
}

function makeFakeAgent() {
  let messages: Message[] = []
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
    event: (msgs: Message[]) =>
      act(() => {
        messages = msgs
        subscriber?.onEvent?.({ messages: msgs })
      }),
    runInitialized: () => act(() => subscriber?.onRunInitialized?.()),
    runFinalized: () => act(() => subscriber?.onRunFinalized?.()),
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
const metrics = { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 }

async function renderWidget() {
  const fake = makeFakeAgent()
  h.current = fake
  const { WidgetChat } = await import('@/app/widget/[widgetToken]/widget-chat')
  render(<WidgetChat widgetToken={TOKEN} renderToken="test-render-token" orgName="Acme" showBranding isSelfPreview={false} leadCaptureMode="off" />)
  return fake
}

const thread = () => screen.getByTestId('chat-thread')
const jump = () => screen.queryByRole('button', { name: 'Jump to latest' })

function userScrollsTo(top: number) {
  fireEvent.wheel(thread())
  metrics.scrollTop = top
  fireEvent.scroll(thread())
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  Object.assign(metrics, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => metrics.scrollHeight })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => metrics.clientHeight })
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get: () => metrics.scrollTop,
    set: (v: number) => (metrics.scrollTop = v),
  })
  HTMLElement.prototype.scrollTo = function (opts?: ScrollToOptions | number) {
    const top = typeof opts === 'object' ? (opts.top ?? 0) : 0
    metrics.scrollTop = Math.min(top, metrics.scrollHeight - metrics.clientHeight)
  } as HTMLElement['scrollTo']
})

describe('WidgetChat: Jump to latest', () => {
  it('appears over the conversation when a reply arrives while the visitor is scrolled up, and takes them down', async () => {
    const fake = await renderWidget()
    await userEvent.setup().type(screen.getByRole('textbox'), 'first{Enter}')
    await fake.runInitialized()
    userScrollsTo(100)

    metrics.scrollHeight = 1200
    await fake.event([
      { id: 'u1', role: 'user', content: 'first' },
      { id: 'a1', role: 'assistant', content: 'A long reply arriving…' },
    ] as Message[])
    expect(metrics.scrollTop).toBe(100)
    const button = jump()!
    expect(button).not.toBeNull()
    expect(button.className).toContain('bg-brand-600')
    expect(button.className).toContain('text-on-brand')
    expect(button.className).toContain('focus-visible:ring-brand-400')

    fireEvent.click(button)
    expect(metrics.scrollTop).toBe(800)
    expect(jump()).toBeNull()
  })

  it('sending a question brings the view to the bottom even when the visitor had scrolled up', async () => {
    const fake = await renderWidget()
    await fake.event([
      { id: 'u0', role: 'user', content: 'earlier' },
      { id: 'a0', role: 'assistant', content: 'Earlier answer.' },
    ] as Message[])
    userScrollsTo(100)
    metrics.scrollHeight = 1100
    await userEvent.setup().type(screen.getByRole('textbox'), 'next{Enter}')
    expect(metrics.scrollTop).toBe(700)
    expect(jump()).toBeNull()
  })
})

describe('WidgetChat: typing indicator', () => {
  it('fades its dots instead of bouncing, sits still with reduced motion, and is one reply line tall', async () => {
    const fake = await renderWidget()
    await userEvent.setup().type(screen.getByRole('textbox'), 'q{Enter}')
    await fake.runInitialized()
    const indicator = screen.getByTestId('typing-indicator')
    const dots = indicator.querySelectorAll('[aria-hidden="true"] > span')
    expect(dots).toHaveLength(3)
    for (const dot of dots) {
      expect(dot.className).not.toContain('animate-bounce')
      expect(dot.className).toContain('motion-reduce:animate-none')
    }
    // Same bubble and line height as a reply, so the reply replaces it in place.
    const bubble = indicator.querySelector('.rounded-2xl')!
    expect(bubble.className).toContain('text-xs')
    expect(bubble.className).toContain('leading-relaxed')
    expect(bubble.className).toContain('py-2')
    expect(indicator.querySelector('.h-\\[1\\.625em\\]')).not.toBeNull()
    expect(indicator.querySelector('output')?.textContent).toBe('Typing')
  })

  it('card placeholders stop pulsing with reduced motion', () => {
    const { container } = render(<CardSkeleton />)
    const bars = container.querySelectorAll('.animate-pulse')
    expect(bars.length).toBeGreaterThan(0)
    for (const bar of bars) expect(bar.className).toContain('motion-reduce:animate-none')
  })
})
