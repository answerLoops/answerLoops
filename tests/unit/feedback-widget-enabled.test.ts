import { describe, it, expect, afterEach } from 'vitest'
import { isFeedbackWidgetEnabled } from '@/lib/product-feedback/enabled'

describe('isFeedbackWidgetEnabled', () => {
  const original = process.env.FEEDBACK_WIDGET_ENABLED
  afterEach(() => {
    if (original === undefined) delete process.env.FEEDBACK_WIDGET_ENABLED
    else process.env.FEEDBACK_WIDGET_ENABLED = original
  })

  it('is off by default', () => {
    delete process.env.FEEDBACK_WIDGET_ENABLED
    expect(isFeedbackWidgetEnabled()).toBe(false)
  })

  it.each(['true', 'TRUE', '1', ' true '])('is on for %j', (v) => {
    process.env.FEEDBACK_WIDGET_ENABLED = v
    expect(isFeedbackWidgetEnabled()).toBe(true)
  })

  it.each(['', '0', 'false', 'yes', 'on'])('stays off for %j', (v) => {
    process.env.FEEDBACK_WIDGET_ENABLED = v
    expect(isFeedbackWidgetEnabled()).toBe(false)
  })
})
