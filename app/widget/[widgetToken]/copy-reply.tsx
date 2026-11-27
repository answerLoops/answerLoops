'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { copyPlainText, replyPlainText } from '@/lib/widget/reply-plain-text'

/** How long "Copied" (or "Couldn't copy") shows before the button reads "Copy" again. */
export const COPY_CONFIRM_MS = 2000

type Status = 'idle' | 'copied' | 'failed'

/**
 * The Copy action under one completed assistant reply. It copies the reply as
 * the visitor reads it (lib/widget/reply-plain-text.ts), never its Markdown and
 * never the cards under it. Nothing about copying is recorded or sent.
 *
 * On a device with a mouse it stays invisible until the reply is hovered or
 * something in it has keyboard focus, then fades in. It only changes opacity,
 * so the conversation never shifts. On a touch screen it is always visible and
 * at least 44px tall. With reduced motion the fade is instant.
 */
export function CopyReply({ bubbleRef }: { bubbleRef: RefObject<HTMLElement | null> }) {
  const [status, setStatus] = useState<Status>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  async function copy() {
    const bubble = bubbleRef.current
    const text = bubble ? replyPlainText(bubble) : ''
    const ok = text !== '' && (await copyPlainText(text))
    setStatus(ok ? 'copied' : 'failed')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setStatus('idle'), COPY_CONFIRM_MS)
  }

  const label = status === 'copied' ? 'Copied' : status === 'failed' ? "Couldn't copy" : 'Copy'

  return (
    <div className="pl-8">
      <button
        type="button"
        aria-label="Copy reply"
        data-testid="copy-reply"
        onClick={() => void copy()}
        className={[
          'inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[0.6875rem] font-medium text-gray-500',
          'transition-opacity duration-150 motion-reduce:transition-none',
          // Brand tint behind dark gray text: brand-50 is always near-white, so the
          // label stays readable whatever brand color the owner picked.
          'hover:bg-brand-50 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
          // Mouse and trackpad: smaller, and hidden until the reply is hovered or focused.
          'pointer-fine:min-h-7',
          status === 'idle'
            ? 'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100'
            : '',
        ].join(' ')}
      >
        {status === 'copied' ? <Check /> : <CopyIcon />}
        <span>{label}</span>
      </button>
      {/* Announced once per copy; the button's own name stays "Copy reply". */}
      <output className="sr-only" aria-live="polite">
        {status === 'copied' ? 'Reply copied' : status === 'failed' ? "Couldn't copy the reply" : ''}
      </output>
    </div>
  )
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  )
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
