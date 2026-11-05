import { describe, expect, it } from 'vitest'
import { describeAge, isResolution, sortBySaved } from '@/lib/kb/resolution-age'

const NOW = Date.parse('2026-11-05T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('describeAge', () => {
  it('says today for anything under a full day, including a moment ago', () => {
    expect(describeAge(ago(0), NOW)).toBe('today')
    expect(describeAge(ago(DAY - 1), NOW)).toBe('today')
  })

  it('says yesterday for exactly one elapsed day up to just under two', () => {
    expect(describeAge(ago(DAY), NOW)).toBe('yesterday')
    expect(describeAge(ago(2 * DAY - 1), NOW)).toBe('yesterday')
  })

  it('counts days from 2 through 6', () => {
    expect(describeAge(ago(2 * DAY), NOW)).toBe('2 days ago')
    expect(describeAge(ago(6 * DAY), NOW)).toBe('6 days ago')
    expect(describeAge(ago(7 * DAY - 1), NOW)).toBe('6 days ago')
  })

  it('uses singular and plural weeks', () => {
    expect(describeAge(ago(7 * DAY), NOW)).toBe('1 week ago')
    expect(describeAge(ago(13 * DAY), NOW)).toBe('1 week ago')
    expect(describeAge(ago(14 * DAY), NOW)).toBe('2 weeks ago')
    expect(describeAge(ago(29 * DAY), NOW)).toBe('4 weeks ago')
  })

  it('uses singular and plural months', () => {
    expect(describeAge(ago(30 * DAY), NOW)).toBe('1 month ago')
    expect(describeAge(ago(59 * DAY), NOW)).toBe('1 month ago')
    expect(describeAge(ago(60 * DAY), NOW)).toBe('2 months ago')
    expect(describeAge(ago(364 * DAY), NOW)).toBe('12 months ago')
  })

  it('uses singular and plural years', () => {
    expect(describeAge(ago(365 * DAY), NOW)).toBe('1 year ago')
    expect(describeAge(ago(729 * DAY), NOW)).toBe('1 year ago')
    expect(describeAge(ago(730 * DAY), NOW)).toBe('2 years ago')
    expect(describeAge(ago(5 * 365 * DAY), NOW)).toBe('5 years ago')
  })

  it('treats a date in the future as today rather than a negative age', () => {
    expect(describeAge(new Date(NOW + 3 * DAY).toISOString(), NOW)).toBe('today')
    expect(describeAge(new Date(NOW + 1000).toISOString(), NOW)).toBe('today')
  })

  it('returns null for text that is not a date', () => {
    expect(describeAge('not a date', NOW)).toBeNull()
    expect(describeAge('', NOW)).toBeNull()
  })

  it('defaults to the current time when no now is given', () => {
    expect(describeAge(new Date().toISOString())).toBe('today')
    expect(describeAge(new Date(Date.now() - 3 * DAY).toISOString())).toBe('3 days ago')
  })
})

describe('sortBySaved', () => {
  const row = (id: number, updated_at: string) => ({ id, updated_at })

  it('puts the most recently saved first when newest', () => {
    const rows = [row(1, '2026-01-01T00:00:00Z'), row(2, '2026-03-01T00:00:00Z'), row(3, '2026-02-01T00:00:00Z')]
    expect(sortBySaved(rows, 'newest').map((r) => r.id)).toEqual([2, 3, 1])
  })

  it('puts the least recently saved first when oldest', () => {
    const rows = [row(1, '2026-01-01T00:00:00Z'), row(2, '2026-03-01T00:00:00Z'), row(3, '2026-02-01T00:00:00Z')]
    expect(sortBySaved(rows, 'oldest').map((r) => r.id)).toEqual([1, 3, 2])
  })

  it('keeps the original order for equal dates in both directions', () => {
    const same = '2026-05-05T00:00:00Z'
    const rows = [row(1, same), row(2, same), row(3, same), row(4, '2026-06-01T00:00:00Z')]
    expect(sortBySaved(rows, 'newest').map((r) => r.id)).toEqual([4, 1, 2, 3])
    expect(sortBySaved(rows, 'oldest').map((r) => r.id)).toEqual([1, 2, 3, 4])
  })

  it('always sorts unreadable dates last, in both orders, keeping their relative order', () => {
    const rows = [row(1, 'garbage'), row(2, '2026-01-01T00:00:00Z'), row(3, ''), row(4, '2026-03-01T00:00:00Z')]
    expect(sortBySaved(rows, 'newest').map((r) => r.id)).toEqual([4, 2, 1, 3])
    expect(sortBySaved(rows, 'oldest').map((r) => r.id)).toEqual([2, 4, 1, 3])
  })

  it('does not change the input array', () => {
    const rows = [row(1, '2026-01-01T00:00:00Z'), row(2, '2026-03-01T00:00:00Z')]
    const snapshot = [...rows]
    const out = sortBySaved(rows, 'newest')
    expect(out).not.toBe(rows)
    expect(rows).toEqual(snapshot)
    expect(rows.map((r) => r.id)).toEqual([1, 2])
  })

  it('handles an empty list', () => {
    expect(sortBySaved([], 'newest')).toEqual([])
  })
})

describe('isResolution', () => {
  it('is true when the article came from a ticket', () => {
    expect(isResolution({ source_ticket_id: 7 })).toBe(true)
  })

  it('is false when there is no source ticket', () => {
    expect(isResolution({ source_ticket_id: null })).toBe(false)
    expect(isResolution({ source_ticket_id: undefined as unknown as null })).toBe(false)
  })
})
