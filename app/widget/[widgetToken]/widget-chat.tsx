'use client'

import { useChat } from '@ai-sdk/react'
import { TextStreamChatTransport } from 'ai'
import type { UIMessage } from 'ai'
import { useEffect, useMemo, useRef, useState } from 'react'

interface WidgetChatProps {
  widgetToken: string
  orgName: string
  showBranding: boolean
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

export function WidgetChat({ widgetToken, orgName, showBranding }: WidgetChatProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState('')
  const [email, setEmail] = useState('')
  const [emailSubmitted, setEmailSubmitted] = useState(false)
  const [emailPending, setEmailPending] = useState(false)
  const [emailError, setEmailError] = useState('')

  const visitorId = useMemo(() => getOrCreateVisitorId(), [])

  const { messages, sendMessage, status, error } = useChat({
    transport: new TextStreamChatTransport({
      api: '/api/widget/chat',
      body: { widgetToken, visitorId },
    }),
  })

  const isLoading = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    sendMessage({ text: input })
    setInput('')
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
        body: JSON.stringify({ widgetToken, email: email.trim() }),
      })
    } catch {
      // non-blocking — still let them in
    }
    setEmailPending(false)
    setEmailSubmitted(true)
  }

  const BotIcon = () => (
    <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1 14.5v-9l7 4.5-7 4.5z"/>
    </svg>
  )

  return (
    <div className="flex flex-col h-screen bg-white font-sans text-sm">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-100 bg-white shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600">
          <BotIcon />
        </div>
        <div>
          <p className="font-semibold text-gray-900 text-xs">{orgName} Support</p>
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
            {emailError && <p className="text-[0.625rem] text-red-500">{emailError}</p>}
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

            {messages.map((m: UIMessage) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'assistant' && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 mr-2 mt-0.5">
                    <svg className="h-3 w-3 text-brand-600" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1 14.5v-9l7 4.5-7 4.5z"/>
                    </svg>
                  </div>
                )}
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-brand-600 text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                }`}>
                  {m.parts
                    .filter((p) => p.type === 'text')
                    .map((p, i) => (
                      <span key={i}>{(p as { type: 'text'; text: string }).text}</span>
                    ))}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 mr-2 mt-0.5">
                  <svg className="h-3 w-3 text-brand-600" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1 14.5v-9l7 4.5-7 4.5z"/>
                  </svg>
                </div>
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
              <p className="text-center text-xs text-red-400">Something went wrong. Please try again.</p>
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
  )
}
