'use client'

import { useCallback, useRef, useSyncExternalStore } from 'react'

export type VisualViewportMetrics = {
  /** Height of the area actually visible to the user (shrinks for the on-screen keyboard). */
  height: number
  /** Distance between the bottom of the layout viewport and the bottom of the visual viewport. */
  bottomInset: number
}

function measure(vv: VisualViewport): VisualViewportMetrics {
  return {
    height: vv.height,
    bottomInset: Math.max(0, window.innerHeight - vv.height - vv.offsetTop),
  }
}

/**
 * Tracks `window.visualViewport` so fixed-position UI can stay above the
 * on-screen keyboard (`dvh` does not shrink for it on iOS Safari and many
 * Android browsers). Returns null before mount, when the API is unsupported,
 * or while `enabled` is false — in which case no listeners are attached.
 */
export function useVisualViewport(enabled = true): VisualViewportMetrics | null {
  const last = useRef<VisualViewportMetrics | null>(null)

  const subscribe = useCallback(
    (onChange: () => void) => {
      const vv = typeof window === 'undefined' ? undefined : window.visualViewport
      if (!enabled || !vv) return () => {}
      vv.addEventListener('resize', onChange)
      vv.addEventListener('scroll', onChange)
      return () => {
        vv.removeEventListener('resize', onChange)
        vv.removeEventListener('scroll', onChange)
      }
    },
    [enabled],
  )

  // useSyncExternalStore needs a referentially stable snapshot between
  // changes, so reuse the previous object while the numbers are the same.
  const getSnapshot = useCallback((): VisualViewportMetrics | null => {
    const vv = typeof window === 'undefined' ? undefined : window.visualViewport
    if (!enabled || !vv) {
      last.current = null
      return null
    }
    const next = measure(vv)
    const prev = last.current
    if (prev && prev.height === next.height && prev.bottomInset === next.bottomInset) return prev
    last.current = next
    return next
  }, [enabled])

  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}
