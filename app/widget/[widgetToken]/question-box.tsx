'use client'

import { useLayoutEffect, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import { MESSAGE_MAX_CHARS } from '@/lib/widget/transcript'

/** The box grows with the text up to this many lines, then scrolls inside itself. */
export const QUESTION_BOX_MAX_LINES = 5

/**
 * Whether this device has a mouse or trackpad. Only these get the cursor put in
 * the box when the chat opens; on a touch screen that would pop the on-screen
 * keyboard up over the answer area before the visitor has read anything.
 *
 * The same test as the `pointer-fine:` sizes below, so a device that gets the
 * smaller mouse-sized box is also the one that gets the cursor.
 */
export function hasFinePointer(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches
  } catch {
    return false
  }
}

/**
 * True for an Enter that should send: not with Shift (which adds a new line)
 * and not while text is still being composed with an input method, where
 * Enter confirms the characters rather than finishing the question.
 */
export function isSendKey(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'nativeEvent'> & { keyCode?: number }): boolean {
  if (e.key !== 'Enter' || e.shiftKey) return false
  const native = e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number }
  if (native.isComposing) return false
  // Some browsers report keys pressed during composition as keyCode 229.
  if (native.keyCode === 229 || e.keyCode === 229) return false
  return true
}

/**
 * The widget's question box: a rounded text area that grows to
 * QUESTION_BOX_MAX_LINES lines and then scrolls, with a send button beside it.
 * Typing stays possible while an answer is arriving; only sending waits.
 *
 * Text is 16px on touch screens, so phones do not zoom in when it is tapped,
 * and the box and button are at least 44px tall there. With a mouse they keep
 * the smaller size the chat has always used.
 */
export function QuestionBox({
  value,
  onChange,
  onSend,
  busy,
  boxRef,
}: {
  value: string
  onChange: (value: string) => void
  /** Called with the question when it should be sent. */
  onSend: (question: string) => void
  /** True while an answer is arriving: the question can be written but not sent. */
  busy: boolean
  boxRef: RefObject<HTMLTextAreaElement | null>
}) {
  const canSend = !busy && value.trim() !== ''

  // Grow with the text, up to the line limit, and shrink back when it is cleared.
  // It measures the rendered box rather than reading `value`, but must run
  // every time `value` changes (typing, a restored draft, clearing on send),
  // so `value` is a dependency on purpose.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    box.style.height = 'auto'
    const style = window.getComputedStyle(box)
    const lineHeight = Number.parseFloat(style.lineHeight) || 20
    const padding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
    const max = lineHeight * QUESTION_BOX_MAX_LINES + padding
    const next = Math.min(box.scrollHeight, max)
    if (next > 0) box.style.height = `${next}px`
    box.style.overflowY = box.scrollHeight > max ? 'auto' : 'hidden'
  }, [value, boxRef])

  function send() {
    if (!canSend) return
    onSend(value)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    send()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!isSendKey(e)) return
    // Enter never adds a line; it sends when it can and otherwise does nothing.
    e.preventDefault()
    send()
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <textarea
        ref={boxRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        maxLength={MESSAGE_MAX_CHARS}
        placeholder="Ask a question…"
        aria-label="Your question"
        enterKeyHint="send"
        className="block min-h-11 flex-1 resize-none rounded-[22px] border border-gray-200 bg-gray-50 px-4 py-2.5 text-base leading-6 text-gray-900 placeholder-gray-400 transition-colors focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 pointer-fine:min-h-8 pointer-fine:py-1.5 pointer-fine:text-xs pointer-fine:leading-5"
      />
      <button
        type="submit"
        aria-label="Send message"
        disabled={!canSend}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-on-brand transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 disabled:opacity-40 pointer-fine:h-8 pointer-fine:w-8"
      >
        <svg className="h-3.5 w-3.5 rotate-90" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
      </button>
    </form>
  )
}
