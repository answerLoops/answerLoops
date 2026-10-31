import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mintLeadQuestionToken,
  verifyLeadQuestionToken,
  sanitizeLeadQuestion,
} from '@/lib/widget/lead-question-token'

/**
 * lib/widget/lead-question-token.ts — the signed proof that a lead's question
 * is one the server recorded for a failed widget turn, not caller-supplied text.
 */

const TOKEN = 'a'.repeat(48)
const OTHER_TOKEN = 'b'.repeat(48)

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-auth-secret-value'
})
afterEach(() => {
  delete process.env.AUTH_SECRET
})

describe('lead question token: round trip', () => {
  it('returns the question that was signed', () => {
    const t = mintLeadQuestionToken(TOKEN, 'how do I export my data?')!
    expect(verifyLeadQuestionToken(t, TOKEN)).toBe('how do I export my data?')
  })

  it('mints nothing for an empty or whitespace-only question', () => {
    expect(mintLeadQuestionToken(TOKEN, '')).toBeNull()
    expect(mintLeadQuestionToken(TOKEN, '  \n\t ')).toBeNull()
  })
})

describe('lead question token: rejects anything the server did not sign', () => {
  it('rejects a token minted for a different widget', () => {
    const t = mintLeadQuestionToken(TOKEN, 'hello there')!
    expect(verifyLeadQuestionToken(t, OTHER_TOKEN)).toBeNull()
  })

  it('rejects a payload that was edited after signing', () => {
    const t = mintLeadQuestionToken(TOKEN, 'real question')!
    const [, sig] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ w: TOKEN, q: 'buy pills at example.test', e: Date.now() + 60_000 })).toString(
      'base64url'
    )
    expect(verifyLeadQuestionToken(`${forged}.${sig}`, TOKEN)).toBeNull()
  })

  it('rejects a token signed under a different secret', () => {
    const t = mintLeadQuestionToken(TOKEN, 'real question')!
    process.env.AUTH_SECRET = 'a-different-secret'
    expect(verifyLeadQuestionToken(t, TOKEN)).toBeNull()
  })

  it('rejects an expired token', () => {
    const t = mintLeadQuestionToken(TOKEN, 'real question', 1_000)!
    expect(verifyLeadQuestionToken(t, TOKEN, 1_000 + 31 * 60_000)).toBeNull()
    expect(verifyLeadQuestionToken(t, TOKEN, 1_000 + 29 * 60_000)).toBe('real question')
  })

  it('rejects garbage, non-strings and oversized input without throwing', () => {
    for (const bad of [undefined, null, 42, {}, '', 'no-dot', '.', 'a.b', 'x'.repeat(5000)]) {
      expect(verifyLeadQuestionToken(bad, TOKEN), String(bad)).toBeNull()
    }
  })

  it('fails closed (throws) when AUTH_SECRET is unset, rather than accepting everything', () => {
    delete process.env.AUTH_SECRET
    expect(() => mintLeadQuestionToken(TOKEN, 'q')).toThrow(/AUTH_SECRET/)
  })
})

describe('sanitizeLeadQuestion', () => {
  it('flattens control characters and runs of whitespace into single spaces', () => {
    expect(sanitizeLeadQuestion('line one\r\nline\ttwo\u0007  three')).toBe('line one line two three')
  })

  it('removes Unicode line and paragraph separators', () => {
    expect(sanitizeLeadQuestion('a b c')).toBe('a b c')
  })

  it('caps the length', () => {
    expect(sanitizeLeadQuestion('x'.repeat(2000)).length).toBe(500)
  })

  it('stores a sanitised question even if the signed payload held raw control characters', () => {
    const t = mintLeadQuestionToken(TOKEN, 'a\nb')!
    expect(verifyLeadQuestionToken(t, TOKEN)).toBe('a b')
  })
})
