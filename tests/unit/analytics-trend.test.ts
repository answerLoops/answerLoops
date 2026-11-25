import { describe, expect, it } from 'vitest'
import { DEFAULT_TREND_RANGE, TREND_RANGES, fillTrendDays, parseTrendRange } from '@/lib/analytics/trend'

const NOW = new Date('2026-11-25T15:30:00.000Z')

describe('parseTrendRange', () => {
  it.each([[7, 7], [30, 30], [90, 90]])('accepts %s days', (input, expected) => {
    expect(parseTrendRange(String(input))).toBe(expected)
  })

  it.each([undefined, '', 'abc', '14', '0', '-7', '365', '30.5'])('falls back to the default for %j', (input) => {
    expect(parseTrendRange(input)).toBe(DEFAULT_TREND_RANGE)
  })

  it('uses the first value when the parameter repeats', () => {
    expect(parseTrendRange(['7', '90'])).toBe(7)
  })

  it('offers 7, 30 and 90 days, with 30 as the default', () => {
    expect([...TREND_RANGES]).toEqual([7, 30, 90])
    expect(DEFAULT_TREND_RANGE).toBe(30)
  })
})

describe('fillTrendDays', () => {
  it('returns one point per day, oldest first, ending today', () => {
    const out = fillTrendDays([], 7, NOW)
    expect(out).toHaveLength(7)
    expect(out[0].day).toBe('2026-11-19')
    expect(out[6].day).toBe('2026-11-25')
  })

  it('fills quiet days with zeros and keeps the days that had answers', () => {
    const out = fillTrendDays(
      [{ day: '2026-11-23', answered: 6, deflected: 4 }, { day: '2026-11-25', answered: 2, deflected: 2 }],
      4,
      NOW
    )
    expect(out).toEqual([
      { day: '2026-11-22', answered: 0, deflected: 0 },
      { day: '2026-11-23', answered: 6, deflected: 4 },
      { day: '2026-11-24', answered: 0, deflected: 0 },
      { day: '2026-11-25', answered: 2, deflected: 2 },
    ])
  })

  it('ignores a point from outside the window', () => {
    const out = fillTrendDays([{ day: '2026-01-01', answered: 9, deflected: 9 }], 3, NOW)
    expect(out.reduce((n, p) => n + p.answered, 0)).toBe(0)
  })

  it('spans a month boundary correctly', () => {
    const out = fillTrendDays([], 3, new Date('2026-12-01T01:00:00.000Z'))
    expect(out.map((p) => p.day)).toEqual(['2026-11-29', '2026-11-30', '2026-12-01'])
  })

  it('handles a single day', () => {
    expect(fillTrendDays([{ day: '2026-11-25', answered: 1, deflected: 0 }], 1, NOW)).toEqual([
      { day: '2026-11-25', answered: 1, deflected: 0 },
    ])
  })
})
