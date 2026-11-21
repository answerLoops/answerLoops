import { describe, it, expect } from 'vitest'
import { DEFAULT_WIDGET_DISPLAY, resolveWidgetDisplay } from '@/lib/widget/display-settings'

describe('widget display settings', () => {
  it('serves today\'s look when nothing has been chosen', () => {
    expect(resolveWidgetDisplay(null, { customization: true })).toEqual(DEFAULT_WIDGET_DISPLAY)
    expect(resolveWidgetDisplay({}, { customization: true })).toEqual(DEFAULT_WIDGET_DISPLAY)
    expect(DEFAULT_WIDGET_DISPLAY).toEqual({ windowSize: 'small', bubbleColor: '#2563eb', bubbleIconColor: '#ffffff', logoPath: null })
  })

  it('honours a choice when the plan includes customization', () => {
    expect(
      resolveWidgetDisplay({ windowSize: 'large', bubbleColor: '#AA00FF' }, { customization: true })
    ).toEqual({ windowSize: 'large', bubbleColor: '#aa00ff', bubbleIconColor: '#ffffff', logoPath: null })
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
    ).toEqual({ windowSize: 'medium', bubbleColor: '#2563eb', bubbleIconColor: '#ffffff', logoPath: null })
  })

  it('returns a copy, so a caller cannot change the shared default', () => {
    const a = resolveWidgetDisplay(null, { customization: false })
    a.bubbleColor = '#000000'
    expect(DEFAULT_WIDGET_DISPLAY.bubbleColor).toBe('#2563eb')
  })
})


describe('the logo address in the display settings', () => {
  const PATH = `/api/widget/logo/${'c3'.repeat(24)}?v=0123456789abcdef`

  it('passes a logo address of our own through on a customization plan', () => {
    expect(resolveWidgetDisplay({ bubbleColor: null, logoPath: PATH }, { customization: true }).logoPath).toBe(PATH)
  })

  it('drops it on a plan without customization', () => {
    expect(resolveWidgetDisplay({ bubbleColor: '#aa00ff', logoPath: PATH }, { customization: false }).logoPath).toBeNull()
  })

  it.each([
    'https://evil.test/logo.png',
    '//evil.test/x',
    'javascript:alert(1)',
    `${PATH}&x=1`,
    '',
  ])('drops an address that is not one of ours: %s', (bad) => {
    expect(resolveWidgetDisplay({ bubbleColor: null, logoPath: bad }, { customization: true }).logoPath).toBeNull()
  })

  it('has none by default', () => {
    expect(DEFAULT_WIDGET_DISPLAY.logoPath).toBeNull()
    expect(resolveWidgetDisplay(null, { customization: true }).logoPath).toBeNull()
  })
})
