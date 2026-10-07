import { describe, it, expect } from 'vitest'
import {
  FEEDBACK_MAX_CHARS,
  FEEDBACK_MIN_CHARS,
  containsLink,
  isReplyTag,
  validateFeedbackBody,
} from '@/lib/product-feedback/validation'
import { formatBoardDate, parseBoardDate } from '@/lib/product-feedback/dates'

const OK = 'This is a perfectly reasonable piece of feedback text.'

describe('validateFeedbackBody', () => {
  it('accepts feedback within the length bounds', () => {
    expect(validateFeedbackBody(OK)).toBeNull()
  })

  it('rejects feedback under the minimum, measured after trimming', () => {
    const short = 'x'.repeat(FEEDBACK_MIN_CHARS - 1)
    expect(validateFeedbackBody(short)).toMatch(/at least 35/)
    expect(validateFeedbackBody(`   ${short}   `)).toMatch(/at least 35/)
    expect(validateFeedbackBody('x'.repeat(FEEDBACK_MIN_CHARS))).toBeNull()
  })

  it('rejects feedback over the maximum', () => {
    expect(validateFeedbackBody('x'.repeat(FEEDBACK_MAX_CHARS + 1))).toMatch(/at most 500/)
    expect(validateFeedbackBody('x'.repeat(FEEDBACK_MAX_CHARS))).toBeNull()
  })

  it('rejects links even when the length is fine', () => {
    expect(validateFeedbackBody(`${OK} See https://example.com/page`)).toMatch(/Links/)
  })
})

describe('containsLink', () => {
  it.each([
    'visit https://example.com',
    'http://example.com',
    'ftp://files.example.org',
    'go to www.example',
    'check example.com now',
    'try my-site.io today',
    'EXAMPLE.COM',
  ])('flags %s', (text) => {
    expect(containsLink(text)).toBe(true)
  })

  it.each([
    'I love the new dashboard layout',
    'The setup took 3.5 minutes which was great',
    'Works with Slack, Discord and Google Chat',
  ])('does not flag %s', (text) => {
    expect(containsLink(text)).toBe(false)
  })
})

describe('isReplyTag', () => {
  it('accepts known tags only', () => {
    expect(isReplyTag('shipped')).toBe(true)
    expect(isReplyTag('nope')).toBe(false)
    expect(isReplyTag(null)).toBe(false)
  })
})

describe('board dates', () => {
  it('parses both Postgres text timestamps and ISO strings', () => {
    expect(parseBoardDate('2026-10-07 17:08:00.123+00')?.toISOString()).toBe('2026-10-07T17:08:00.123Z')
    expect(parseBoardDate('2026-10-07T17:08:00.000Z')?.toISOString()).toBe('2026-10-07T17:08:00.000Z')
  })

  it('returns null / empty for garbage rather than "Invalid Date"', () => {
    expect(parseBoardDate('not a date')).toBeNull()
    expect(formatBoardDate('not a date')).toBe('')
  })
})
