import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_WIDGET_USAGE_LIMITS,
  MAX_WIDGET_LIMIT_VALUE,
  WIDGET_USAGE_LIMIT_ENV,
  dailyLimitAlert,
  effectiveDailyLimit,
  normalizeDailyLimit,
  widgetUsageLimits,
  type WidgetUsageLimits,
} from '@/lib/widget/usage-limits'

/**
 * lib/widget/usage-limits.ts: the instance's widget limits (env vars with
 * defaults), the owner's own daily limit (validated on write, clamped on read),
 * and when the owner is emailed about the day's count.
 */

afterEach(() => {
  vi.unstubAllEnvs()
})

function clearLimitEnv() {
  for (const name of Object.values(WIDGET_USAGE_LIMIT_ENV)) vi.stubEnv(name, '')
}

describe('widgetUsageLimits', () => {
  it('returns the defaults when no variable is set', () => {
    clearLimitEnv()
    expect(widgetUsageLimits()).toEqual(DEFAULT_WIDGET_USAGE_LIMITS)
    expect(DEFAULT_WIDGET_USAGE_LIMITS).toEqual({
      perVisitorPerMinute: 20,
      perWidgetPerMinute: 100,
      perAddressPerMinute: 60,
      perWorkspacePerHour: 500,
      perWorkspacePerDay: 3_000,
      loadsPerAddressPerMinute: 30,
      loadsPerWidgetPerMinute: 600,
    })
  })

  it('reads each limit from its own variable, leaving the others at their defaults', () => {
    for (const key of Object.keys(WIDGET_USAGE_LIMIT_ENV) as (keyof WidgetUsageLimits)[]) {
      clearLimitEnv()
      vi.stubEnv(WIDGET_USAGE_LIMIT_ENV[key], '1234')
      const limits = widgetUsageLimits()
      expect(limits[key], key).toBe(1234)
      expect({ ...limits, [key]: DEFAULT_WIDGET_USAGE_LIMITS[key] }).toEqual(DEFAULT_WIDGET_USAGE_LIMITS)
    }
  })

  it('names the documented variables', () => {
    expect(WIDGET_USAGE_LIMIT_ENV).toEqual({
      perVisitorPerMinute: 'WIDGET_LIMIT_PER_VISITOR_PER_MINUTE',
      perWidgetPerMinute: 'WIDGET_LIMIT_PER_WIDGET_PER_MINUTE',
      perAddressPerMinute: 'WIDGET_LIMIT_PER_ADDRESS_PER_MINUTE',
      perWorkspacePerHour: 'WIDGET_LIMIT_PER_WORKSPACE_PER_HOUR',
      perWorkspacePerDay: 'WIDGET_LIMIT_PER_WORKSPACE_PER_DAY',
      loadsPerAddressPerMinute: 'WIDGET_LIMIT_LOADS_PER_ADDRESS_PER_MINUTE',
      loadsPerWidgetPerMinute: 'WIDGET_LIMIT_LOADS_PER_WIDGET_PER_MINUTE',
    })
  })

  it('accepts surrounding whitespace and the bounds themselves', () => {
    clearLimitEnv()
    vi.stubEnv('WIDGET_LIMIT_PER_WORKSPACE_PER_DAY', '  750 ')
    expect(widgetUsageLimits().perWorkspacePerDay).toBe(750)
    vi.stubEnv('WIDGET_LIMIT_PER_WORKSPACE_PER_DAY', '1')
    expect(widgetUsageLimits().perWorkspacePerDay).toBe(1)
    vi.stubEnv('WIDGET_LIMIT_PER_WORKSPACE_PER_DAY', String(MAX_WIDGET_LIMIT_VALUE))
    expect(widgetUsageLimits().perWorkspacePerDay).toBe(MAX_WIDGET_LIMIT_VALUE)
  })

  it.each([
    ['zero', '0'],
    ['negative', '-5'],
    ['decimal', '12.5'],
    ['words', 'lots'],
    ['number with a unit', '100/min'],
    ['scientific notation', '1e3'],
    ['above the maximum', String(MAX_WIDGET_LIMIT_VALUE + 1)],
    ['whitespace only', '   '],
  ])('falls back to the default for a %s value', (_label, value) => {
    clearLimitEnv()
    vi.stubEnv('WIDGET_LIMIT_PER_WORKSPACE_PER_DAY', value)
    vi.stubEnv('WIDGET_LIMIT_PER_VISITOR_PER_MINUTE', value)
    const limits = widgetUsageLimits()
    expect(limits.perWorkspacePerDay).toBe(3_000)
    expect(limits.perVisitorPerMinute).toBe(20)
  })

  it('reads the environment on every call', () => {
    clearLimitEnv()
    vi.stubEnv('WIDGET_LIMIT_PER_WIDGET_PER_MINUTE', '7')
    expect(widgetUsageLimits().perWidgetPerMinute).toBe(7)
    vi.stubEnv('WIDGET_LIMIT_PER_WIDGET_PER_MINUTE', '9')
    expect(widgetUsageLimits().perWidgetPerMinute).toBe(9)
  })

  it('returns a fresh object, so a caller cannot change the defaults', () => {
    clearLimitEnv()
    const limits = widgetUsageLimits()
    limits.perWorkspacePerDay = 1
    expect(DEFAULT_WIDGET_USAGE_LIMITS.perWorkspacePerDay).toBe(3_000)
    expect(widgetUsageLimits().perWorkspacePerDay).toBe(3_000)
  })
})

describe('effectiveDailyLimit', () => {
  it('uses the ceiling when the owner set no limit', () => {
    expect(effectiveDailyLimit(null, 3_000)).toBe(3_000)
    expect(effectiveDailyLimit(undefined, 3_000)).toBe(3_000)
  })

  it("uses the owner's limit when it is below the ceiling", () => {
    expect(effectiveDailyLimit(250, 3_000)).toBe(250)
    expect(effectiveDailyLimit(1, 3_000)).toBe(1)
    expect(effectiveDailyLimit(3_000, 3_000)).toBe(3_000)
  })

  it("never goes above the ceiling, even if a stored owner limit is higher", () => {
    // The ceiling can be lowered after an owner saved a higher value.
    expect(effectiveDailyLimit(5_000, 3_000)).toBe(3_000)
  })

  it('ignores a stored value that could not have been saved', () => {
    expect(effectiveDailyLimit(0, 3_000)).toBe(3_000)
    expect(effectiveDailyLimit(-10, 3_000)).toBe(3_000)
    expect(effectiveDailyLimit(12.5, 3_000)).toBe(3_000)
    expect(effectiveDailyLimit(Number.NaN, 3_000)).toBe(3_000)
  })
})

describe('normalizeDailyLimit', () => {
  it('treats empty input as no limit of the owner\'s own', () => {
    expect(normalizeDailyLimit(null, 3_000)).toEqual({ ok: true, value: null })
    expect(normalizeDailyLimit(undefined, 3_000)).toEqual({ ok: true, value: null })
    expect(normalizeDailyLimit('', 3_000)).toEqual({ ok: true, value: null })
    expect(normalizeDailyLimit('   ', 3_000)).toEqual({ ok: true, value: null })
  })

  it('accepts a whole number, with grouping separators people often type', () => {
    expect(normalizeDailyLimit('500', 3_000)).toEqual({ ok: true, value: 500 })
    expect(normalizeDailyLimit(' 1,500 ', 3_000)).toEqual({ ok: true, value: 1_500 })
    expect(normalizeDailyLimit('2 000', 3_000)).toEqual({ ok: true, value: 2_000 })
    expect(normalizeDailyLimit('2_500', 3_000)).toEqual({ ok: true, value: 2_500 })
    expect(normalizeDailyLimit(1200, 3_000)).toEqual({ ok: true, value: 1_200 })
  })

  it('accepts exactly the ceiling and exactly 1', () => {
    expect(normalizeDailyLimit('3000', 3_000)).toEqual({ ok: true, value: 3_000 })
    expect(normalizeDailyLimit('1', 3_000)).toEqual({ ok: true, value: 1 })
  })

  it.each(['abc', '12.5', '-3', '1e3', '10 answers'])('refuses %j as not a whole number', (raw) => {
    expect(normalizeDailyLimit(raw, 3_000)).toEqual({ ok: false, error: 'Enter a whole number of answers.' })
  })

  it('refuses zero, pointing the owner at the empty field instead', () => {
    const result = normalizeDailyLimit('0', 3_000)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/at least 1 answer a day/)
  })

  it('refuses a value above the ceiling and names the ceiling', () => {
    expect(normalizeDailyLimit('3001', 3_000)).toEqual({
      ok: false,
      error: 'This instance allows at most 3,000 answers a day per workspace.',
    })
    expect(normalizeDailyLimit('600', 500)).toEqual({
      ok: false,
      error: 'This instance allows at most 500 answers a day per workspace.',
    })
  })
})

describe('dailyLimitAlert', () => {
  it("warns at 80% of the limit and reports when it is reached", () => {
    expect(dailyLimitAlert(80, 100)).toBe('warning')
    expect(dailyLimitAlert(100, 100)).toBe('reached')
    expect(dailyLimitAlert(2_400, 3_000)).toBe('warning')
    expect(dailyLimitAlert(3_000, 3_000)).toBe('reached')
  })

  it('says nothing on every other count, so each alert happens once a day', () => {
    for (let count = 0; count <= 120; count++) {
      if (count === 80 || count === 100) continue
      expect(dailyLimitAlert(count, 100), String(count)).toBeNull()
    }
  })

  it('rounds the warning point up', () => {
    // 80% of 7 is 5.6: the warning goes out at the 6th answer.
    expect(dailyLimitAlert(5, 7)).toBeNull()
    expect(dailyLimitAlert(6, 7)).toBe('warning')
    expect(dailyLimitAlert(7, 7)).toBe('reached')
  })

  it('sends only the reached alert when 80% rounds up to the limit itself', () => {
    // A limit of 1: ceil(0.8) is 1. A limit of 4: ceil(3.2) is 4.
    expect(dailyLimitAlert(1, 1)).toBe('reached')
    expect(dailyLimitAlert(4, 4)).toBe('reached')
    expect(dailyLimitAlert(3, 4)).toBeNull()
  })

  it('handles a missing count as no alert', () => {
    expect(dailyLimitAlert(undefined as unknown as number, 100)).toBeNull()
  })
})
