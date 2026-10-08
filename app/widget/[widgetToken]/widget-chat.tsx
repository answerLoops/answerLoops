'use client'

import { CopilotKitProvider } from '@copilotkit/react-core/v2'
import { useAgent, useRenderTool, useRenderToolCall } from '@copilotkit/react-core/v2/headless'
import type { Message } from '@ag-ui/client'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import Image from 'next/image'
import {
  GENUI_TOOL_NAMES,
  calloutSchema,
  choicesSchema,
  contactSchema,
  linkCardSchema,
  parseGenuiResult,
  stepsSchema,
} from '@/lib/widget/genui'
import {
  CalloutCard,
  CardSkeleton,
  ChoicesCard,
  ContactCard,
  LinkCard,
  StepsCard,
  WidgetActionsProvider,
} from './genui-cards'

interface WidgetChatProps {
  widgetToken: string
  renderToken: string
  orgName: string
  showBranding: boolean
  isSelfPreview: boolean
}

const VISITOR_ID_STORAGE_KEY = 'al_visitor_id'

/**
 * Stable per-browser id so the server can resume this visitor's Mastra
 * memory thread across page reloads — see lib/ai/memory.ts. Falls back to a
 * fresh id every render if localStorage is unavailable (private browsing,
 * SSR) rather than throwing; the conversation just won't persist that time.
 */
function getOrCreateVisitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_ID_STORAGE_KEY)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    localStorage.setItem(VISITOR_ID_STORAGE_KEY, fresh)
    return fresh
  } catch {
    return crypto.randomUUID()
  }
}

/**
 * Registers the closed catalog of rich cards with CopilotKit. Each renderer
 * draws from the tool *result* (the server's sanitized payload), never the
 * model's raw arguments, and shows a skeleton until that result arrives. A
 * result that is missing, refused (`ok: false`) or fails the catalog schema
 * renders nothing at all.
 */
function useGenuiRenderers() {
  useRenderTool(
    {
      name: GENUI_TOOL_NAMES.steps,
      parameters: stepsSchema,
      render: ({ status, result }) => {
        if (status !== 'complete') return <CardSkeleton />
        const data = parseGenuiResult(result, stepsSchema)
        return data ? <StepsCard data={data} /> : null
      },
    },
    []
  )
  useRenderTool(
    {
      name: GENUI_TOOL_NAMES.choices,
      parameters: choicesSchema,
      render: ({ status, result }) => {
        if (status !== 'complete') return <CardSkeleton />
        const data = parseGenuiResult(result, choicesSchema)
        return data ? <ChoicesCard data={data} /> : null
      },
    },
    []
  )
  useRenderTool(
    {
      name: GENUI_TOOL_NAMES.callout,
      parameters: calloutSchema,
      render: ({ status, result }) => {
        if (status !== 'complete') return <CardSkeleton />
        const data = parseGenuiResult(result, calloutSchema)
        return data ? <CalloutCard data={data} /> : null
      },
    },
    []
  )
  useRenderTool(
    {
      name: GENUI_TOOL_NAMES.linkCard,
      parameters: linkCardSchema,
      render: ({ status, result }) => {
        if (status !== 'complete') return <CardSkeleton />
        const data = parseGenuiResult(result, linkCardSchema)
        return data ? <LinkCard data={data} /> : null
      },
    },
    []
  )
  useRenderTool(
    {
      name: GENUI_TOOL_NAMES.contact,
      parameters: contactSchema,
      render: ({ status, result }) => {
        if (status !== 'complete') return <CardSkeleton />
        const data = parseGenuiResult(result, contactSchema)
        return data ? <ContactCard data={data} /> : null
      },
    },
    []
  )
  // Any tool the catalog doesn't define draws nothing — a model can't surface
  // a tool the widget has no vetted component for.
  useRenderTool({ name: '*', render: () => null }, [])
}

const EMPTY_RESULTS: Record<string, string> = {}

type ToolCallLike = NonNullable<Extract<Message, { role: 'assistant' }>['toolCalls']>[number]

const BotIcon = ({ size = 14 }: { size?: number }) => (
  <Image src="/logo.png" alt="" width={size} height={size} className="object-contain" />
)

const AssistantAvatar = () => (
  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 mr-2 mt-0.5">
    <BotIcon size={12} />
  </div>
)

interface MessageRowProps {
  message: Message
  // Result payloads for this message's tool calls, keyed by toolCallId.
  toolResults: Record<string, string>
  canReply: boolean
}

/**
 * One chat row. Memoised: while a reply streams, only the message being
 * written changes, so every earlier row (and its cards) can skip re-rendering
 * instead of the whole thread re-rendering on each token.
 */
const MessageRow = memo(
  function MessageRow({ message, toolResults }: MessageRowProps) {
    const renderToolCall = useRenderToolCall()

    if (message.role === 'user') {
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-brand-600 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words text-white">
            {typeof message.content === 'string' ? message.content : ''}
          </div>
        </div>
      )
    }
    if (message.role !== 'assistant') return null

    const text = typeof message.content === 'string' ? message.content : ''
    const cards: ReactElement[] = []
    for (const toolCall of (message.toolCalls ?? []) as ToolCallLike[]) {
      const result = toolResults[toolCall.id]
      const rendered = renderToolCall({
        toolCall,
        toolMessage: result === undefined ? undefined : { id: `${toolCall.id}-result`, role: 'tool', toolCallId: toolCall.id, content: result },
      })
      if (rendered) cards.push(<div key={toolCall.id} className="flex justify-start">{rendered}</div>)
    }
    if (!text && cards.length === 0) return null

    return (
      <>
        {text && (
          <div className="flex justify-start">
            <AssistantAvatar />
            <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-gray-100 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words text-gray-800">
              {text}
            </div>
          </div>
        )}
        {cards.length > 0 && <div className="space-y-2 pl-8">{cards}</div>}
      </>
    )
  },
  (prev, next) => {
    if (prev.canReply !== next.canReply) return false
    if (prev.message === next.message && prev.toolResults === next.toolResults) return true
    const a = prev.message
    const b = next.message
    if (a.id !== b.id || a.role !== b.role || a.content !== b.content) return false
    const ac = a.role === 'assistant' ? (a.toolCalls ?? []) : []
    const bc = b.role === 'assistant' ? (b.toolCalls ?? []) : []
    if (ac.length !== bc.length) return false
    return ac.every(
      (call, i) => call.id === bc[i].id && call.function.arguments === bc[i].function.arguments && prev.toolResults[call.id] === next.toolResults[call.id]
    )
  }
)

export function WidgetChat({ widgetToken, renderToken, orgName, showBranding, isSelfPreview }: WidgetChatProps) {
  const visitorId = useMemo(() => getOrCreateVisitorId(), [])

  return (
    <CopilotKitProvider
      runtimeUrl="/api/widget/chat"
      enableInspector={false}
      useSingleEndpoint
      properties={{ widgetToken, renderToken, visitorId, isSelfPreview }}
    >
      <WidgetChatBody
        widgetToken={widgetToken}
        renderToken={renderToken}
        orgName={orgName}
        showBranding={showBranding}
        visitorId={visitorId}
        isSelfPreview={isSelfPreview}
      />
    </CopilotKitProvider>
  )
}

function WidgetChatBody({
  widgetToken,
  renderToken,
  orgName,
  showBranding,
  visitorId,
  isSelfPreview,
}: {
  widgetToken: string
  renderToken: string
  orgName: string
  showBranding: boolean
  visitorId: string
  isSelfPreview: boolean
}) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState('')
  const [email, setEmail] = useState('')
  const [emailSubmitted, setEmailSubmitted] = useState(false)
  const [emailPending, setEmailPending] = useState(false)
  const [emailError, setEmailError] = useState('')

  const { agent } = useAgent()
  const [messages, setMessages] = useState<Message[]>(agent.messages)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setMessages([...agent.messages])
    const { unsubscribe } = agent.subscribe({
      onEvent: ({ messages: current }) => setMessages([...current]),
      onRunInitialized: () => {
        setError(null)
        setIsLoading(true)
      },
      onRunFinalized: () => setIsLoading(false),
      // The server only puts a specific message in error.message when
      // isSelfPreview asked for one — see app/api/widget/chat/route.ts.
      // Real customer-site visitors get the generic fallback below.
      onRunFailed: ({ error: runError }) => {
        setIsLoading(false)
        // Strip the "HTTP 503: " transport prefix the AG-UI client adds —
        // only the server's own message text is meant for display.
        const message = runError.message.replace(/^HTTP \d+:\s*/, '')
        setError(message || 'Something went wrong. Please try again.')
      },
    })
    return unsubscribe
  }, [agent])

  useEffect(() => {
    // Smooth scrolling restarts its animation on every streamed token and
    // visibly lags behind the text; jump while a reply is arriving.
    bottomRef.current?.scrollIntoView({ behavior: isLoading ? 'auto' : 'smooth' })
  }, [messages, isLoading])

  useGenuiRenderers()

  const toolResultsByMessage = useMemo(() => {
    const byCallId: Record<string, string> = {}
    for (const m of messages) {
      if (m.role === 'tool' && typeof m.content === 'string') byCallId[m.toolCallId] = m.content
    }
    const out = new Map<string, Record<string, string>>()
    for (const m of messages) {
      if (m.role !== 'assistant' || !m.toolCalls?.length) continue
      out.set(m.id, Object.fromEntries(m.toolCalls.filter((c) => c.id in byCallId).map((c) => [c.id, byCallId[c.id]])))
    }
    return out
  }, [messages])

  const sendMessage = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (!text || isLoading) return
      agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: text })
      // addMessage() only mutates the agent's local message list — our
      // `messages` state otherwise only updates from server-pushed onEvent
      // data, so without this the user's own bubble disappears for the whole
      // request round-trip (reappearing only once the server echoes it back).
      setMessages([...agent.messages])
      // agent.runAgent() called bare skips CopilotKitCore's forwardedProps merge
      // (that only happens inside copilotkit.runAgent()) — pass widgetToken and
      // visitorId explicitly or the server never sees them.
      void agent.runAgent({ forwardedProps: { widgetToken, renderToken, visitorId, isSelfPreview } })
    },
    [agent, isLoading, widgetToken, renderToken, visitorId, isSelfPreview]
  )

  const actions = useMemo(() => ({ send: sendMessage, canReply: !isLoading }), [sendMessage, isLoading])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    setInput('')
    sendMessage(input)
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) { setEmailSubmitted(true); return }
    setEmailPending(true)
    setEmailError('')
    try {
      await fetch('/api/widget/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widgetToken, renderToken, email: email.trim() }),
      })
    } catch {
      // non-blocking — still let them in
    }
    setEmailPending(false)
    setEmailSubmitted(true)
  }

  const lastMessage = messages[messages.length - 1]
  // The dots only fill the gap before the reply starts; once text or a card
  // is streaming, the message itself is the progress indicator.
  const showTyping = isLoading && (!lastMessage || lastMessage.role !== 'assistant')

  return (
    <WidgetActionsProvider value={actions}>
    <div className="flex flex-col h-screen bg-white font-sans text-sm">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-100 bg-white shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 shrink-0">
          <BotIcon />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 text-xs truncate">{orgName} Support</p>
          <p className="text-[0.625rem] text-green-500 font-medium">Online</p>
        </div>
      </div>

      {/* Email gate — shown before first message if email not submitted */}
      {!emailSubmitted ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 mb-4">
            <BotIcon />
          </div>
          <h2 className="text-sm font-semibold text-gray-900 mb-1">👋 Hi! How can we help?</h2>
          <p className="text-xs text-gray-400 mb-6">Drop your email to get started — we&apos;ll follow up if needed.</p>
          <form onSubmit={handleEmailSubmit} className="w-full space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs text-gray-900 placeholder-gray-400 focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 transition-colors"
            />
            {emailError && <p className="break-words text-[0.625rem] text-red-500">{emailError}</p>}
            <button
              type="submit"
              disabled={emailPending}
              className="w-full rounded-lg bg-brand-600 py-2.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {emailPending ? 'Starting…' : 'Start chat'}
            </button>
            <button
              type="button"
              onClick={() => setEmailSubmitted(true)}
              className="w-full text-[0.625rem] text-gray-400 hover:text-gray-600 transition-colors"
            >
              Skip
            </button>
          </form>
        </div>
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <p className="text-gray-400 text-xs">👋 Hi! How can I help you today?</p>
              </div>
            )}

            {messages.map((m) => (
              <MessageRow
                key={m.id}
                message={m}
                toolResults={toolResultsByMessage.get(m.id) ?? EMPTY_RESULTS}
                canReply={!isLoading}
              />
            ))}

            {showTyping && (
              <div className="flex justify-start">
                <AssistantAvatar />
                <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-3 py-2">
                  <span className="flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
                  </span>
                </div>
              </div>
            )}

            {error && (
              <p className="break-words text-center text-xs text-red-400">{error}</p>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-gray-100 px-3 py-3 shrink-0">
            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question…"
                className="flex-1 rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-900 placeholder-gray-400 focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 transition-colors"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white disabled:opacity-40 hover:bg-brand-700 transition-colors"
              >
                <svg className="h-3.5 w-3.5 rotate-90" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              </button>
            </form>
            {showBranding && (
              <p className="text-center text-[0.625rem] text-gray-300 mt-2">Powered by answerLoops</p>
            )}
          </div>
        </>
      )}
    </div>
    </WidgetActionsProvider>
  )
}
