import { describe, it, expect } from 'vitest'
import { contentHash } from '@/lib/kb/revision'
import { toVerification, verificationStatus, VERIFICATION_NOTE_MAX } from '@/lib/kb/verification'

/**
 * lib/kb/verification.ts: where an article stands once a person has checked it.
 * It is verified only while its words still match what was checked, and age
 * alone never changes the answer.
 */

const q = 'How do I reset my password?'
const a = 'Use the reset link on the sign-in page.'
const checked = { question: q, answer: a, verifiedContentHash: contentHash(q, a) }

describe('verificationStatus', () => {
  it('is never when nobody has verified the article', () => {
    expect(verificationStatus({ question: q, answer: a, verifiedAt: null, verifiedContentHash: null })).toBe('never')
  })

  it('is verified while the question and answer still match what was checked', () => {
    expect(verificationStatus({ ...checked, verifiedAt: '2026-10-01T00:00:00.000Z' })).toBe('verified')
  })

  it('is still verified long after the check: age alone never changes the status', () => {
    expect(verificationStatus({ ...checked, verifiedAt: '2019-01-01T00:00:00.000Z' })).toBe('verified')
  })

  it('reads as changed once the answer changes', () => {
    expect(verificationStatus({ ...checked, answer: `${a} Then check your email.`, verifiedAt: '2026-10-01T00:00:00.000Z' })).toBe('changed')
  })

  it('reads as changed once the question changes', () => {
    expect(verificationStatus({ ...checked, question: 'How do I change my password?', verifiedAt: '2026-10-01T00:00:00.000Z' })).toBe('changed')
  })

  it('treats a reflow or trailing whitespace as the same content', () => {
    expect(
      verificationStatus({ ...checked, question: `  ${q}\n`, answer: a.replace(' ', '   '), verifiedAt: '2026-10-01T00:00:00.000Z' })
    ).toBe('verified')
  })

  it('reads as changed, never verified, when a date exists but the checked content was not recorded', () => {
    expect(verificationStatus({ question: q, answer: a, verifiedAt: '2026-10-01T00:00:00.000Z', verifiedContentHash: null })).toBe('changed')
  })

  it('verifying again after an edit clears the changed state', () => {
    const edited = { question: q, answer: 'A new answer.' }
    const before = { ...edited, verifiedAt: '2026-10-01T00:00:00.000Z', verifiedContentHash: contentHash(q, a) }
    expect(verificationStatus(before)).toBe('changed')
    expect(verificationStatus({ ...before, verifiedContentHash: contentHash(edited.question, edited.answer) })).toBe('verified')
  })
})

describe('toVerification', () => {
  it('carries the facts the dashboard shows, and the derived status', () => {
    expect(
      toVerification(
        { ...checked, verifiedAt: '2026-10-01T00:00:00.000Z', verifiedBy: 12, verificationNote: 'Checked against v2.4' },
        'Dana'
      )
    ).toEqual({ status: 'verified', verified_at: '2026-10-01T00:00:00.000Z', verified_by: 12, verified_by_name: 'Dana', note: 'Checked against v2.4' })
  })

  it('keeps the date and note but no name when the verifier is gone', () => {
    expect(
      toVerification({ ...checked, verifiedAt: '2026-10-01T00:00:00.000Z', verifiedBy: null, verificationNote: null }, null)
    ).toEqual({ status: 'verified', verified_at: '2026-10-01T00:00:00.000Z', verified_by: null, verified_by_name: null, note: null })
  })

  it('shows an unverified article as never, with nothing filled in', () => {
    expect(
      toVerification({ question: q, answer: a, verifiedAt: null, verifiedBy: null, verifiedContentHash: null, verificationNote: null }, null)
    ).toEqual({ status: 'never', verified_at: null, verified_by: null, verified_by_name: null, note: null })
  })
})

describe('VERIFICATION_NOTE_MAX', () => {
  it('is 500 characters, the length the form and the action both enforce', () => {
    expect(VERIFICATION_NOTE_MAX).toBe(500)
  })
})
