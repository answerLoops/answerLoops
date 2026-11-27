import { describe, it, expect } from 'vitest'
import {
  REVIEW_EFFECT,
  REVIEW_NOTE_MAX,
  REVIEW_STATES,
  REPLACEMENT_URL_MAX,
  isReviewState,
  parseReplacementUrl,
} from '@/lib/kb/review-state'
import { describeHistoryEntry } from '@/lib/kb/history-labels'
import type { KBArticleEventOrigin, KBArticleEventType } from '@/types'

/**
 * lib/kb/review-state.ts (pure helpers and the confirmation copy) and the
 * history titles for the review-state events. The copy is what a person reads
 * before confirming, so these tests pin its meaning, not its exact wording.
 */

describe('REVIEW_STATES and limits', () => {
  it('lists the three states, current first', () => {
    expect(REVIEW_STATES).toEqual(['current', 'needs_review', 'superseded'])
  })

  it('keeps the note and link limits at sensible sizes', () => {
    expect(REVIEW_NOTE_MAX).toBe(500)
    expect(REPLACEMENT_URL_MAX).toBe(2000)
  })
})

describe('isReviewState', () => {
  it.each(['current', 'needs_review', 'superseded'])('accepts %s', (s) => {
    expect(isReviewState(s)).toBe(true)
  })

  it.each([['Current'], ['needs-review'], [''], ['published'], [null], [undefined], [1], [{}], [['current']]])(
    'rejects %j',
    (v) => {
      expect(isReviewState(v)).toBe(false)
    }
  )
})

describe('parseReplacementUrl', () => {
  it.each([
    ['https://docs.example.com/guide', 'https://docs.example.com/guide'],
    ['http://docs.example.com/guide?x=1#y', 'http://docs.example.com/guide?x=1#y'],
    ['  https://docs.example.com/a  ', 'https://docs.example.com/a'],
    ['HTTPS://Docs.Example.COM', 'https://docs.example.com/'],
  ])('accepts %j as %j', (input, out) => {
    expect(parseReplacementUrl(input)).toBe(out)
  })

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['javascript: with slashes', 'javascript://docs.example.com/%0aalert(1)'],
    ['data:', 'data:text/html,<b>hi</b>'],
    ['ftp:', 'ftp://files.example.com/a'],
    ['file:', 'file:///etc/passwd'],
    ['mailto:', 'mailto:help@example.com'],
    ['relative path', '/docs/guide'],
    ['protocol-relative', '//docs.example.com/guide'],
    ['bare host', 'docs.example.com'],
    ['empty', ''],
    ['whitespace', '   \n\t '],
  ])('rejects %s', (_label, input) => {
    expect(parseReplacementUrl(input)).toBeNull()
  })

  it(`accepts a link of exactly ${REPLACEMENT_URL_MAX} characters and rejects one longer`, () => {
    const prefix = 'https://docs.example.com/'
    const exact = prefix + 'a'.repeat(REPLACEMENT_URL_MAX - prefix.length)
    expect(exact).toHaveLength(REPLACEMENT_URL_MAX)
    expect(parseReplacementUrl(exact)).toBe(exact)
    expect(parseReplacementUrl(exact + 'a')).toBeNull()
  })
})

describe('REVIEW_EFFECT says what happens to customers', () => {
  it('flag: customers are unaffected and the team sees it', () => {
    expect(REVIEW_EFFECT.flag).toMatch(/customers still get answers/i)
    expect(REVIEW_EFFECT.flag).not.toMatch(/\b(stops?|no longer|not be used|excluded)\b/i)
    expect(REVIEW_EFFECT.flag).toMatch(/team/i)
  })

  it('clearFlag: customers are unaffected', () => {
    expect(REVIEW_EFFECT.clearFlag).toMatch(/customers already get answers/i)
    expect(REVIEW_EFFECT.clearFlag).toMatch(/(does not|doesn't|won't|will not) change/i)
    expect(REVIEW_EFFECT.clearFlag).not.toMatch(/\b(stops?|no longer|excluded)\b/i)
  })

  it('supersede: the article stops being used for answers', () => {
    expect(REVIEW_EFFECT.supersede).toMatch(/stops being used for answers/i)
    expect(REVIEW_EFFECT.supersede).not.toMatch(/still get answers from this/i)
  })

  it('restore: the article is used for answers again', () => {
    expect(REVIEW_EFFECT.restore).toMatch(/(starts|is) being used for answers again|used for answers again/i)
    expect(REVIEW_EFFECT.restore).not.toMatch(/\b(stops?|no longer|not be used)\b/i)
  })

  it('has copy for exactly the four actions', () => {
    expect(Object.keys(REVIEW_EFFECT).sort()).toEqual(['clearFlag', 'flag', 'restore', 'supersede'])
  })
})

const entry = (
  type: KBArticleEventType,
  origin: KBArticleEventOrigin,
  actor_user_id: number | null = null,
  actor_name: string | null = null
) => ({ type, origin, actor_user_id, actor_name })

describe('history titles for review-state events', () => {
  const NEW_TYPES: KBArticleEventType[] = [
    'flagged_for_review',
    'auto_flagged_for_review',
    'review_flag_cleared',
    'superseded',
    'restored',
  ]

  it.each<[KBArticleEventType, KBArticleEventOrigin, RegExp]>([
    ['flagged_for_review', 'manual', /flagged for review/i],
    ['auto_flagged_for_review', 'sync', /flagged for review.*changed/i],
    ['review_flag_cleared', 'manual', /flag cleared/i],
    ['superseded', 'manual', /superseded/i],
    ['restored', 'manual', /restored/i],
  ])('%s from %s has its own title', (type, origin, re) => {
    const title = describeHistoryEntry(entry(type, origin, 5, 'Dana')).title
    expect(title).toMatch(re)
    expect(title).not.toBe('Changed')
  })

  it('gives each new event a title distinct from every other event type', () => {
    const titles = NEW_TYPES.map((t) => describeHistoryEntry(entry(t, 'manual', 5, 'Dana')).title)
    expect(new Set(titles).size).toBe(NEW_TYPES.length)
    const older: KBArticleEventType[] = ['created', 'promoted', 'edited', 'review_approved', 'review_rejected', 'review_reopened', 'verified']
    const olderTitles = new Set(older.map((t) => describeHistoryEntry(entry(t, 'manual', 5, 'Dana')).title))
    for (const t of titles) expect(olderTitles.has(t)).toBe(false)
  })

  it('shows an auto flag from a sync as Synced, never a person, even if a name is present', () => {
    expect(describeHistoryEntry(entry('auto_flagged_for_review', 'sync', 12, 'Dana'))).toMatchObject({
      actor: 'Synced',
      automated: true,
    })
    expect(describeHistoryEntry(entry('auto_flagged_for_review', 'sync')).actor).toBe('Synced')
  })

  it('shows a person who flagged or superseded by name', () => {
    expect(describeHistoryEntry(entry('flagged_for_review', 'manual', 12, 'Dana'))).toMatchObject({
      actor: 'Dana',
      automated: false,
    })
    expect(describeHistoryEntry(entry('superseded', 'manual', 12, 'Dana')).actor).toBe('Dana')
  })
})
