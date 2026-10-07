'use client'

import { useEffect, useState } from 'react'

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
  const [metrics, setMetrics] = useState<VisualViewportMetrics | null>(null)

  useEffect(() => {
    const vv = typeof window === 'undefined' ? undefined : window.visualViewport
    if (!enabled || !vv) {
      setMetrics(null)
      return
    }
    const update = () => setMetrics(measure(vv))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [enabled])

  return metrics
}
