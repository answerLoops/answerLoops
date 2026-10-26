import { describe, it, expect } from 'vitest'
import { sourceStatus } from '@/lib/kb/answer-sources'
import { contentHash } from '@/lib/kb/revision'

/**
 * Where a source stands now compared with what was supplied to the answer.
 * The stored hash is the article as it was then, so the result stays accurate
 * after the article is edited, unpublished or deleted.
 */

const Q = 'How do I reset my password?'
const A = 'Use the reset link on the sign-in page.'
const stored = contentHash(Q, A)

describe('sourceStatus', () => {
  it('is current when the article still matches what was supplied', () => {
    expect(sourceStatus(stored, { question: Q, answer: A, published: 1 })).toBe('current')
  })

  it('is changed when the words were edited after the answer', () => {
    expect(sourceStatus(stored, { question: Q, answer: `${A} It expires in an hour.`, published: 1 })).toBe('changed')
    expect(sourceStatus(stored, { question: 'How do I change my password?', answer: A, published: 1 })).toBe('changed')
  })

  it('does not count a reflow or trailing whitespace as a change', () => {
    expect(sourceStatus(stored, { question: `${Q}\n`, answer: A.replace(/ /g, '  '), published: 1 })).toBe('current')
  })

  it('is unpublished when the article is no longer live', () => {
    expect(sourceStatus(stored, { question: Q, answer: A, published: 0 })).toBe('unpublished')
  })

  it('is deleted when the article is gone', () => {
    expect(sourceStatus(stored, null)).toBe('deleted')
  })

  it('reads an article that is both unpublished and edited as unpublished, the thing a reader can act on', () => {
    expect(sourceStatus(stored, { question: Q, answer: 'Something else.', published: 0 })).toBe('unpublished')
  })

  it('treats any published value other than 1 as not live', () => {
    expect(sourceStatus(stored, { question: Q, answer: A, published: 2 })).toBe('unpublished')
  })
})
