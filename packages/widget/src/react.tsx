import { useEffect, useRef } from 'react'
import { mountWidget, type WidgetOptions } from './index'

export type { WidgetOptions } from './index'

/**
 * Renders nothing; shows the answerLoops chat bubble while it is mounted.
 * Place it once, in the layout that wraps every page.
 */
export function AnswerLoopsWidget({ widgetId, baseUrl, onError }: WidgetOptions): null {
  // Kept in a ref so an inline callback does not tear the widget down and
  // reload it on every render.
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  })

  useEffect(() => {
    const handle = mountWidget({ widgetId, baseUrl, onError: (error) => onErrorRef.current?.(error) })
    return () => handle.unmount()
  }, [widgetId, baseUrl])

  return null
}
