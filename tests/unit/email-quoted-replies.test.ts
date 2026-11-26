import { describe, expect, it } from 'vitest'
import { stripQuotedReplies } from '@/lib/email/quoted-replies'

// The behaviour email ingest had before this helper existed, kept here only as
// the reference the new implementation must match.
function reference(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.startsWith('>'))
    .join('\n')
    .replace(/\nOn [\s\S]+?wrote:\s*$/, '')
    .trim()
}

describe('stripQuotedReplies', () => {
  it('keeps only what the sender wrote above a quoted reply', () => {
    const body = [
      'Thanks, that fixed it.',
      '',
      'On Tue, Nov 25, 2026 at 9:14 AM Support <help@example.com> wrote:',
      '',
    ].join('\n')
    expect(stripQuotedReplies(body)).toBe('Thanks, that fixed it.')
  })

  it('drops lines quoted with ">"', () => {
    const body = 'New question here\n> old line one\n> old line two\nsigned, Sam'
    expect(stripQuotedReplies(body)).toBe('New question here\nsigned, Sam')
  })

  it('removes from the first "On" line when the text ends in "wrote:"', () => {
    const body = 'Reply\nOn Monday Ana wrote:\nmiddle\nOn Sunday Ben wrote:'
    expect(stripQuotedReplies(body)).toBe('Reply')
  })

  it('leaves the text alone when it does not end in "wrote:"', () => {
    const body = 'Reply\nOn Monday Ana wrote: something after'
    expect(stripQuotedReplies(body)).toBe(body)
  })

  it('needs something between "On " and "wrote:"', () => {
    expect(stripQuotedReplies('Hi\nOn wrote:')).toBe('Hi\nOn wrote:')
    expect(stripQuotedReplies('Hi\nOn Xwrote:')).toBe('Hi')
  })

  it('handles empty and header-only input', () => {
    expect(stripQuotedReplies('')).toBe('')
    expect(stripQuotedReplies('   \n  ')).toBe('')
    expect(stripQuotedReplies('On Monday Ana wrote:')).toBe('On Monday Ana wrote:')
    expect(stripQuotedReplies('\nOn Monday Ana wrote:')).toBe('')
  })

  it('matches the previous behaviour on generated input', () => {
    // Small alphabet built from the pieces the rule looks for, so the cases
    // hit every branch: quote lines, header lines, "wrote:" endings, spacing.
    const parts = ['\n', '\nOn ', 'On ', 'wrote:', 'wrote', '>', ' ', '\t', 'a', 'X', '\r\n']
    let seed = 12345
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let i = 0; i < 5000; i++) {
      const len = rand(14)
      let s = ''
      for (let j = 0; j < len; j++) s += parts[rand(parts.length)]
      expect(stripQuotedReplies(s), JSON.stringify(s)).toBe(reference(s))
    }
  })

  it('handles a very large body with many header-like lines', () => {
    const body = 'Top line' + '\nOn and on'.repeat(200_000) + '\nend'
    expect(stripQuotedReplies(body)).toBe(body)
    expect(stripQuotedReplies(body + ' wrote:')).toBe('Top line')
  })
})
