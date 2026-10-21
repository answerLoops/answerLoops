import { describe, it, expect } from 'vitest'
import { contentHash } from '@/lib/kb/revision'

/**
 * lib/kb/revision.ts: the content fingerprint that history records instead of
 * a copy of an article's text. It has to ignore formatting-only differences and
 * react to every change in the words.
 */

describe('contentHash', () => {
  it('is a stable hex SHA-256', () => {
    const h = contentHash('How do I reset my password?', 'Use the reset link.')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(contentHash('How do I reset my password?', 'Use the reset link.')).toBe(h)
  })

  it('ignores line endings, trailing whitespace and runs of spaces', () => {
    const base = contentHash('How do I reset?', 'Step one.\nStep two.')
    expect(contentHash('  How do I reset?  ', 'Step one.\r\nStep two.\n')).toBe(base)
    expect(contentHash('How  do   I\treset?', 'Step one.\n\n  Step two.')).toBe(base)
  })

  it('changes when the question or the answer changes', () => {
    const base = contentHash('q', 'a')
    expect(contentHash('q!', 'a')).not.toBe(base)
    expect(contentHash('q', 'a!')).not.toBe(base)
  })

  it('treats the question and answer as separate fields', () => {
    expect(contentHash('ab', 'c')).not.toBe(contentHash('a', 'bc'))
    expect(contentHash('a', 'b')).not.toBe(contentHash('b', 'a'))
  })

  it('does not collide on text that merely contains the other field', () => {
    expect(contentHash('q', 'a","b')).not.toBe(contentHash('q","a', 'b'))
  })
})
