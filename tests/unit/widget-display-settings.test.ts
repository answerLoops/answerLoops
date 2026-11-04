import { describe, it, expect } from 'vitest'
import { DEFAULT_WIDGET_DISPLAY, resolveWidgetDisplay } from '@/lib/widget/display-settings'

describe('widget display settings', () => {
  it('serves today\'s look when nothing has been chosen', () => {
    expect(resolveWidgetDisplay(null, { customization: true })).toEqual(DEFAULT_WIDGET_DISPLAY)
    expect(resolveWidgetDisplay({}, { customization: true })).toEqual(DEFAULT_WIDGET_DISPLAY)
    expect(DEFAULT_WIDGET_DISPLAY).toEqual({ windowSize: 'small', bubbleColor: '#4f46e5' })
  })

  it('honours a choice when the plan includes customization', () => {
    expect(
      resolveWidgetDisplay({ windowSize: 'large', bubbleColor: '#AA00FF' }, { customization: true })
    ).toEqual({ windowSize: 'large', bubbleColor: '#aa00ff' })
  })

  it('ignores the choice entirely when the plan does not include it', () => {
    expect(
      resolveWidgetDisplay({ windowSize: 'large', bubbleColor: '#aa00ff' }, { customization: false })
    ).toEqual(DEFAULT_WIDGET_DISPLAY)
  })

  it('falls back per field for unknown sizes and unsafe colors', () => {
    expect(
      resolveWidgetDisplay({ windowSize: 'huge', bubbleColor: 'red;}body{display:none' }, { customization: true })
    ).toEqual(DEFAULT_WIDGET_DISPLAY)
    expect(
      resolveWidgetDisplay({ windowSize: 'medium', bubbleColor: 'blue' }, { customization: true })
    ).toEqual({ windowSize: 'medium', bubbleColor: '#4f46e5' })
  })

  it('returns a copy, so a caller cannot change the shared default', () => {
    const a = resolveWidgetDisplay(null, { customization: false })
    a.bubbleColor = '#000000'
    expect(DEFAULT_WIDGET_DISPLAY.bubbleColor).toBe('#4f46e5')
  })
})
