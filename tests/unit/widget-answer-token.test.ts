import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mintAnswerToken,
  mintFlagToken,
  verifyAnswerToken,
  verifyFlagToken,
} from '@/lib/widget/answer-token'

/**
 * lib/widget/answer-token.ts: the signed references the flag route accepts in
 * place of a bare answer id, flag id or text. Each must verify only for the
 * widget it was minted for, only before it expires, only as its own kind, and
 * never after any change to it.
 */

const W = 'a'.repeat(48)
const OTHER = 'b'.repeat(48)
const ANSWER_ID = '3f0c2b9e-5d1a-4c7e-9a43-0b6d8e2f1a77'
const ref = { answerId: ANSWER_ID, question: 'how do I export?', answer: 'Use Settings > Export.' }

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-auth-secret-value'
})
afterEach(() => {
  delete process.env.AUTH_SECRET
})

describe('answer token', () => {
  it('round-trips the answer id, question and reply for the widget it was minted for', () => {
    const token = mintAnswerToken(W, ref)!
    expect(verifyAnswerToken(token, W)).toEqual(ref)
  })

  it('does not verify for another widget', () => {
    expect(verifyAnswerToken(mintAnswerToken(W, ref), OTHER)).toBeNull()
  })

  it('expires after six hours', () => {
    const now = 1_000_000
    const token = mintAnswerToken(W, ref, now)
    expect(verifyAnswerToken(token, W, now + 5 * 60 * 60_000)).not.toBeNull()
    expect(verifyAnswerToken(token, W, now + 7 * 60 * 60_000)).toBeNull()
  })

  it('refuses a token that has been altered, including its text', () => {
    const token = mintAnswerToken(W, ref)!
    const [payload, sig] = token.split('.')
    const forged = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    forged.a = 'Visit example.test for a refund'
    const tampered = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`
    expect(verifyAnswerToken(tampered, W)).toBeNull()
    expect(verifyAnswerToken(`${payload}.${sig.slice(0, -2)}xx`, W)).toBeNull()
  })

  it('refuses things that are not tokens', () => {
    for (const bad of [undefined, null, 12, '', 'nodot', '.sig', 'x'.repeat(20_000)]) {
      expect(verifyAnswerToken(bad, W)).toBeNull()
    }
  })

  it('does not mint for something that is not an answer id', () => {
    expect(mintAnswerToken(W, { ...ref, answerId: 'not-a-uuid' })).toBeNull()
  })

  it('caps the text it carries', () => {
    const token = mintAnswerToken(W, { ...ref, question: 'q'.repeat(5000), answer: 'a'.repeat(50_000) })!
    const out = verifyAnswerToken(token, W)!
    expect(out.question.length).toBe(1000)
    expect(out.answer.length).toBe(6000)
  })

  it('is not accepted as a flag token', () => {
    expect(verifyFlagToken(mintAnswerToken(W, ref), W)).toBeNull()
  })

  it('cannot be minted or checked without AUTH_SECRET', () => {
    delete process.env.AUTH_SECRET
    expect(() => mintAnswerToken(W, ref)).toThrow(/AUTH_SECRET/)
  })
})

describe('flag token', () => {
  it('round-trips a flag id for the widget it was minted for', () => {
    expect(verifyFlagToken(mintFlagToken(W, 42), W)).toBe(42)
  })

  it('does not verify for another widget or after an hour', () => {
    const now = 5_000_000
    const token = mintFlagToken(W, 42, now)
    expect(verifyFlagToken(token, OTHER, now)).toBeNull()
    expect(verifyFlagToken(token, W, now + 61 * 60_000)).toBeNull()
  })

  it('is not accepted as an answer token', () => {
    expect(verifyAnswerToken(mintFlagToken(W, 42), W)).toBeNull()
  })

  it('refuses a token whose id is not a positive integer', () => {
    expect(verifyFlagToken(mintFlagToken(W, 0), W)).toBeNull()
    expect(verifyFlagToken(mintFlagToken(W, 1.5), W)).toBeNull()
  })
})
