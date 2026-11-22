import { describe, it, expect, vi } from 'vitest'

// The scrubber lives next to the review queue's capture code, which pulls in
// the embedding client; only its pure scrubbing function is needed here.
vi.mock('@/lib/ai/embed', () => ({ embedText: vi.fn() }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: vi.fn() }))
vi.mock('@/lib/db/queries/kb-review', () => ({ recordReviewItem: vi.fn() }))

import { cleanFlagText } from '@/lib/widget/flag-text'

describe('cleanFlagText', () => {
  it('replaces emails, phone numbers and long digit runs', () => {
    const out = cleanFlagText('mail me at jo@example.com or +44 7911 123456, order 12345678', 500, false)
    expect(out).not.toContain('jo@example.com')
    expect(out).not.toContain('7911')
    expect(out).not.toContain('12345678')
    expect(out).toContain('[email]')
  })

  it('flattens a single-line value and strips control characters', () => {
    expect(cleanFlagText('a\n\nb\u0000c d', 500, false)).toBe('a b c d')
  })

  it('keeps paragraph breaks when asked, but not runs of blank lines', () => {
    expect(cleanFlagText('one\n\n\n\n\ntwo', 500, true)).toBe('one\n\ntwo')
  })

  it('trims and caps', () => {
    expect(cleanFlagText('  ' + 'x'.repeat(50) + '  ', 10, false)).toBe('x'.repeat(10))
  })

  it('returns an empty string for anything that is not text', () => {
    for (const v of [undefined, null, 5, {}, []]) expect(cleanFlagText(v, 100, false)).toBe('')
  })
})
