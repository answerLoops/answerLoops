// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Message } from '@ag-ui/client'
import { loadDraft, saveDraft } from '@/lib/widget/transcript'

/**
 * The question box inside WidgetChat: the unsent question survives the panel
 * closing and the chat page loading fresh, sending clears it, blocked storage
 * does not break the box, and the cursor goes into the box when the panel opens
 * on a device with a mouse but not on a touch screen. The agent is faked the
 * same way as in widget-chat-component.test.tsx.
 */

type Subscriber = { onRunInitialized?: () => void; onRunFinalized?: () => void }

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
    runInitialized: () => act(() => subscriber?.onRunInitialized?.()),
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
  render(<WidgetChat widgetToken={TOKEN} renderToken="test-render-token" orgName="Acme" showBranding isSelfPreview={false} leadCaptureMode="off" />)
  return fake
}

const box = () => screen.getByRole('textbox', { name: 'Your question' }) as HTMLTextAreaElement

function setPointer(fine: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: fine && q === '(hover: hover) and (pointer: fine)' }))
}

/** Makes the chat page think it is inside the embed's frame, with `parent` as the host page. */
function embedIn(parent: object) {
  Object.defineProperty(window, 'parent', { value: parent, configurable: true })
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  setPointer(false)
})

afterEach(() => {
  Object.defineProperty(window, 'parent', { value: window, configurable: true })
  vi.unstubAllGlobals()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
})

describe('WidgetChat: the unsent question is kept', () => {
  it('restores a question typed before the panel closed, when the chat page loads again', async () => {
    saveDraft(TOKEN, 'How do I export my')
    await renderWidget()
    expect(box().value).toBe('How do I export my')
  })

  it('saves what is typed, and clears it from the box and the browser once sent', async () => {
    const fake = await renderWidget()
    const user = userEvent.setup()
    await user.type(box(), 'How do I export?')
    expect(loadDraft(TOKEN)).toBe('How do I export?')

    await user.type(box(), '{Enter}')
    expect(fake.agent.addMessage).toHaveBeenCalledWith(expect.objectContaining({ role: 'user', content: 'How do I export?' }))
    expect(box().value).toBe('')
    expect(loadDraft(TOKEN)).toBe('')
  })

  it('keeps the draft for a different widget separate', async () => {
    saveDraft('b'.repeat(48), 'another site')
    await renderWidget()
    expect(box().value).toBe('')
  })

  it('still works when browser storage is blocked', async () => {
    const blocked = () => {
      throw new Error('SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked)
    const fake = await renderWidget()
    const user = userEvent.setup()
    await user.type(box(), 'Still works{Enter}')
    expect(fake.agent.addMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'Still works' }))
    expect(box().value).toBe('')
    vi.restoreAllMocks()
  })
})

describe('WidgetChat: the cursor goes into the box when the panel opens', () => {
  const opened = (source: unknown) =>
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'answerloops:panel-opened' }, source: source as Window }))
    })

  it('on a device with a mouse, when the embed says the panel opened', async () => {
    setPointer(true)
    const host = {}
    embedIn(host)
    await renderWidget()
    expect(box()).not.toHaveFocus()
    await opened(host)
    expect(box()).toHaveFocus()
  })

  it('not on a touch screen, so the on-screen keyboard does not pop up', async () => {
    setPointer(false)
    const host = {}
    embedIn(host)
    await renderWidget()
    await opened(host)
    expect(box()).not.toHaveFocus()
  })

  it('ignores the message when it does not come from the host page', async () => {
    setPointer(true)
    embedIn({})
    await renderWidget()
    await opened({})
    expect(box()).not.toHaveFocus()
  })

  it('when the chat is opened in its own tab, as soon as it loads (mouse only)', async () => {
    setPointer(true)
    await renderWidget()
    expect(box()).toHaveFocus()
  })

  it('in its own tab on a touch screen, it waits for the visitor to tap', async () => {
    setPointer(false)
    await renderWidget()
    expect(box()).not.toHaveFocus()
  })
})
