'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** How close to the bottom (in pixels) still counts as "at the bottom". */
export const AT_BOTTOM_THRESHOLD_PX = 48

export function isAtBottom(el: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_THRESHOLD_PX
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Keeps the conversation at its newest message only while the visitor is
 * already there. Each time `content` changes:
 *
 *  - at (or within AT_BOTTOM_THRESHOLD_PX of) the bottom, the view follows the
 *    new content: instantly while a reply is arriving (`streaming`), smoothly
 *    otherwise, and instantly with reduced motion;
 *  - scrolled up, the view is left where it is and `showJump` turns on, so the
 *    chat can offer a "Jump to latest" button.
 *
 * `showJump` turns off when the visitor scrolls back to the bottom by hand or
 * uses `jumpToLatest`. `followNow` is for the visitor's own message: it always
 * brings the view to the bottom.
 *
 * A scroll the chat starts itself is not mistaken for the visitor scrolling up:
 * while one is in flight, positions short of the bottom are ignored until it
 * arrives, or until the visitor touches the wheel, the screen or the keyboard.
 *
 * `container` is the element itself (from a callback ref held in state), not a
 * ref object, because the conversation area can appear after the first render;
 * the listeners attach whenever it does.
 */
export function useFollowLatest(
  container: HTMLElement | null,
  content: unknown,
  streaming: boolean
): { showJump: boolean; jumpToLatest: () => void; followNow: () => void } {
  const atBottom = useRef(true)
  const autoScrolling = useRef(false)
  // Read when content changes; a reply finishing is not new content by itself.
  const streamingRef = useRef(streaming)
  // The latest content, for the scroll handler to record what has been seen.
  const contentRef = useRef(content)
  // Whether the visitor has scrolled away from the bottom, and the content
  // they had in front of them when they did (or last came back). "Jump to
  // latest" shows only while they are away and something has changed since.
  const away = useRef(false)
  const [scrolledAway, setScrolledAway] = useState(false)
  const [seen, setSeen] = useState<unknown>(content)
  const showJump = scrolledAway && content !== seen

  // Declared before the follow effect below, so they run first in each commit.
  useLayoutEffect(() => {
    streamingRef.current = streaming
  }, [streaming])
  useLayoutEffect(() => {
    contentRef.current = content
  }, [content])

  const backAtBottom = useCallback(() => {
    atBottom.current = true
    away.current = false
    setScrolledAway(false)
    setSeen(contentRef.current)
  }, [])

  const scrollToBottom = useCallback(
    (smooth: boolean) => {
      const el = container
      if (!el) return
      atBottom.current = true
      autoScrolling.current = true
      el.scrollTo({ top: el.scrollHeight, behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' })
      if (isAtBottom(el)) autoScrolling.current = false
    },
    [container]
  )

  useEffect(() => {
    const el = container
    if (!el) return
    const onScroll = () => {
      if (isAtBottom(el)) {
        autoScrolling.current = false
        if (away.current) backAtBottom()
        else atBottom.current = true
        return
      }
      if (autoScrolling.current) return
      atBottom.current = false
      if (!away.current) {
        away.current = true
        setScrolledAway(true)
        setSeen(contentRef.current)
      }
    }
    // Anything the visitor does to scroll ends an automatic scroll at once, so
    // their scroll is never overridden.
    const userScroll = () => {
      autoScrolling.current = false
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', userScroll, { passive: true })
    el.addEventListener('touchstart', userScroll, { passive: true })
    el.addEventListener('keydown', userScroll)
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', userScroll)
      el.removeEventListener('touchstart', userScroll)
      el.removeEventListener('keydown', userScroll)
    }
  }, [container, backAtBottom])

  // Before paint, so following the new text never shows a frame of the view
  // jumping and coming back. `content` is not read here: it is the trigger, so
  // this runs each time the conversation changes. A visitor who has scrolled
  // away is left alone; showJump above already reflects the change.
  useLayoutEffect(() => {
    if (atBottom.current) scrollToBottom(!streamingRef.current)
  }, [content, scrollToBottom])

  const jumpToLatest = useCallback(() => {
    scrollToBottom(true)
    backAtBottom()
  }, [scrollToBottom, backAtBottom])

  return { showJump, jumpToLatest, followNow: backAtBottom }
}
