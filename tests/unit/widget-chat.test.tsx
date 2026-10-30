// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WIDGET_LEAD_SIGNAL_HEADER, type WidgetLeadSignal } from '@/lib/widget/lead-capture'

// `vi.mock` factories are hoisted above imports, so anything they close over
// has to come from `vi.hoisted` rather than a plain module-scope `let`.
const { transportInstances, useChatMock, sendMessageMock } = vi.hoisted(() => {
  return {
    transportInstances: [] as Array<{ options: Record<string, unknown> }>,
    useChatMock: vi.fn(),
    sendMessageMock: vi.fn(),
  }
})

// Stub `ai`'s TextStreamChatTransport: WidgetChat only ever constructs one
// and reads nothing back off it, so a class that records its constructor
// options (so the test can reach the `fetch` wrapper passed in) is enough —
// no real network/stream machinery is exercised.
vi.mock('ai', () => ({
  TextStreamChatTransport: class {
    options: Record<string, unknown>
    constructor(options: Record<string, unknown>) {
      this.options = options
      transportInstances.push(this)
    }
  },
}))

// Stub `@ai-sdk/react`'s useChat: the component's own logic (gate vs. chat,
// the on-failure prompt) is what's under test, not useChat's internals, so
// the mock just hands back a controllable messages/status/error tuple and
// lets the test invoke the `onFinish` callback the component registered.
vi.mock('@ai-sdk/react', () => ({
  useChat: useChatMock,
}))

import { WidgetChat } from '@/app/widget/[widgetToken]/widget-chat'

let lastOnFinish: (() => void) | undefined

function setupUseChatMock() {
  useChatMock.mockImplementation((options: { onFinish?: () => void }) => {
    lastOnFinish = options.onFinish
    return {
      messages: [],
      sendMessage: sendMessageMock,
      status: 'ready',
      error: undefined,
    }
  })
}

function latestTransportFetch(): (input: unknown, init?: unknown) => Promise<unknown> {
  const instance = transportInstances.at(-1)
  if (!instance) throw new Error('no TextStreamChatTransport was constructed')
  return instance.options.fetch as (input: unknown, init?: unknown) => Promise<unknown>
}

/**
 * Simulates the chat route responding with a given lead-capture signal
 * header, by driving the custom `fetch` WidgetChat passes into
 * TextStreamChatTransport (the one that reads the header off the real
 * response), then firing the `onFinish` callback the way useChat would once
 * the stream actually closes.
 */
async function simulateTurnFinish(signal: WidgetLeadSignal) {
  const transportFetch = latestTransportFetch()
  await act(async () => {
    await transportFetch('/api/widget/chat', {})
  })
  act(() => {
    lastOnFinish?.()
  })
}

function fakeChatResponse(signal: WidgetLeadSignal) {
  return {
    headers: {
      get: (name: string) => (name === WIDGET_LEAD_SIGNAL_HEADER ? signal : null),
    },
  }
}

const defaultProps = {
  widgetToken: 'tok-123',
  orgName: 'Acme',
  showBranding: true,
}

beforeEach(() => {
  transportInstances.length = 0
  lastOnFinish = undefined
  useChatMock.mockReset()
  sendMessageMock.mockClear()
  setupUseChatMock()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      // The custom transport fetch cares about the signal header; the plain
      // POST to /api/widget/lead never inspects the response at all — one
      // fake Response-like shape covers both call sites.
      if (typeof input === 'string' && input === '/api/widget/lead') {
        return fakeChatResponse('none')
      }
      return fakeChatResponse(currentSignal)
    })
  )
})

let currentSignal: WidgetLeadSignal = 'none'

describe('WidgetChat', () => {
  it("mode='up-front' renders the email gate first, and Skip reveals the chat input", async () => {
    render(<WidgetChat {...defaultProps} leadCaptureMode="up-front" />)

    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Ask a question…')).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByText('Skip'))

    expect(screen.getByPlaceholderText('Ask a question…')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('you@example.com')).not.toBeInTheDocument()
  })

  it("mode='off' shows the chat input immediately and never renders the email gate", () => {
    render(<WidgetChat {...defaultProps} leadCaptureMode="off" />)

    expect(screen.getByPlaceholderText('Ask a question…')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('you@example.com')).not.toBeInTheDocument()
  })

  it("mode='on-failure' shows the chat input immediately with no gate", () => {
    render(<WidgetChat {...defaultProps} leadCaptureMode="on-failure" />)

    expect(screen.getByPlaceholderText('Ask a question…')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('you@example.com')).not.toBeInTheDocument()
  })

  it("mode='on-failure' shows the inline failure prompt after a 'no-kb-match' signal finishes a turn", async () => {
    render(<WidgetChat {...defaultProps} leadCaptureMode="on-failure" />)
    currentSignal = 'no-kb-match'

    await simulateTurnFinish('no-kb-match')

    const prompt = screen.getByTestId('failure-lead-prompt')
    expect(prompt).toBeInTheDocument()
    expect(prompt).toHaveTextContent(/couldn't find anything on that in our knowledge base/i)
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument()
  })

  it("mode='on-failure' does not show the failure prompt after a 'none' signal finishes a turn", async () => {
    render(<WidgetChat {...defaultProps} leadCaptureMode="on-failure" />)
    currentSignal = 'none'

    await simulateTurnFinish('none')

    expect(screen.queryByTestId('failure-lead-prompt')).not.toBeInTheDocument()
  })

  it("mode='on-failure': dismissing the failure prompt hides it, and a later failing signal does not bring it back", async () => {
    render(<WidgetChat {...defaultProps} leadCaptureMode="on-failure" />)
    currentSignal = 'no-kb-match'
    await simulateTurnFinish('no-kb-match')
    expect(screen.getByTestId('failure-lead-prompt')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByText('No thanks'))
    expect(screen.queryByTestId('failure-lead-prompt')).not.toBeInTheDocument()

    currentSignal = 'no-kb-match'
    await simulateTurnFinish('no-kb-match')

    expect(screen.queryByTestId('failure-lead-prompt')).not.toBeInTheDocument()
  })

  it("mode='on-failure': submitting an email in the failure prompt posts it and hides the prompt", async () => {
    render(<WidgetChat {...defaultProps} leadCaptureMode="on-failure" />)
    currentSignal = 'human-requested'
    await simulateTurnFinish('human-requested')
    expect(screen.getByTestId('failure-lead-prompt')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('you@example.com'), 'visitor@example.com')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/widget/lead',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ widgetToken: 'tok-123', email: 'visitor@example.com' }),
        })
      )
    })

    await waitFor(() => {
      expect(screen.queryByTestId('failure-lead-prompt')).not.toBeInTheDocument()
    })
  })

  it("mode='off' never shows the failure prompt even if a turn would otherwise signal failure", async () => {
    render(<WidgetChat {...defaultProps} leadCaptureMode="off" />)
    currentSignal = 'no-kb-match'

    await simulateTurnFinish('no-kb-match')

    expect(screen.queryByTestId('failure-lead-prompt')).not.toBeInTheDocument()
  })
})
