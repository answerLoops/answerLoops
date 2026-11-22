import { describe, it, expect } from 'vitest'
import { DEFAULT_WIDGET_DISPLAY, resolveWidgetDisplay } from '@/lib/widget/display-settings'

describe('widget display settings', () => {
  it('serves today\'s look when nothing has been chosen', () => {
    expect(resolveWidgetDisplay(null, { customization: true })).toEqual(DEFAULT_WIDGET_DISPLAY)
    expect(resolveWidgetDisplay({}, { customization: true })).toEqual(DEFAULT_WIDGET_DISPLAY)
    expect(DEFAULT_WIDGET_DISPLAY).toEqual({ windowSize: 'small', bubbleColor: '#2563eb', bubbleIconColor: '#ffffff', logoVersion: null })
  })

  it('honours a choice when the plan includes customization', () => {
    expect(
      resolveWidgetDisplay({ windowSize: 'large', bubbleColor: '#AA00FF' }, { customization: true })
    ).toEqual({ windowSize: 'large', bubbleColor: '#aa00ff', bubbleIconColor: '#ffffff', logoVersion: null })
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
    ).toEqual({ windowSize: 'medium', bubbleColor: '#2563eb', bubbleIconColor: '#ffffff', logoVersion: null })
  })

  it('returns a copy, so a caller cannot change the shared default', () => {
    const a = resolveWidgetDisplay(null, { customization: false })
    a.bubbleColor = '#000000'
    expect(DEFAULT_WIDGET_DISPLAY.bubbleColor).toBe('#2563eb')
  })
})


describe('the logo version in the display settings', () => {
  const VERSION = 786432123456

  it('passes the version number through on a customization plan', () => {
    expect(resolveWidgetDisplay({ bubbleColor: null, logoVersion: VERSION }, { customization: true }).logoVersion).toBe(VERSION)
  })

  it('drops it on a plan without customization', () => {
    expect(resolveWidgetDisplay({ bubbleColor: '#aa00ff', logoVersion: VERSION }, { customization: false }).logoVersion).toBeNull()
  })

  it.each([
    ['a string', '/evil'],
    ['a numeric string', '123'],
    ['a negative number', -1],
    ['a fraction', 1.5],
    ['not a number', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['a number too large to be exact', 2 ** 60],
    ['an object', {}],
  ])('drops %s', (_label, bad) => {
    const stored = { bubbleColor: null, logoVersion: bad } as unknown as Parameters<typeof resolveWidgetDisplay>[0]
    expect(resolveWidgetDisplay(stored, { customization: true }).logoVersion).toBeNull()
  })

  it('has none by default', () => {
    expect(DEFAULT_WIDGET_DISPLAY.logoVersion).toBeNull()
    expect(resolveWidgetDisplay(null, { customization: true }).logoVersion).toBeNull()
  })
})
