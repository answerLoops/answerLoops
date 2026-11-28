import { describe, expect, it } from 'vitest'
import { REPLY_FAILURE_COPY, classifyReplyFailure } from '@/lib/widget/reply-failure'

/**
 * How a failed widget reply is described to the visitor
 * (lib/widget/reply-failure.ts): a lost connection, a busy moment, or
 * anything else, in plain words that never carry technical detail.
 */

describe('classifyReplyFailure', () => {
  it('says the visitor is offline when the browser says so, whatever the error', () => {
    expect(classifyReplyFailure('HTTP 503: Service Unavailable', false)).toBe('offline')
    expect(classifyReplyFailure('anything', false)).toBe('offline')
  })

  it.each(['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed', 'Network request failed'])(
    'treats a request that never got a response (%s) as a lost connection',
    (message) => {
      expect(classifyReplyFailure(message, true)).toBe('offline')
    }
  )

  it.each([429, 502, 503, 504])('treats HTTP %i as a busy or temporary problem', (status) => {
    expect(classifyReplyFailure(`HTTP ${status}: whatever the server said`, true)).toBe('busy')
  })

  it.each([400, 404, 500])('treats HTTP %i as a general failure', (status) => {
    expect(classifyReplyFailure(`HTTP ${status}: whatever the server said`, true)).toBe('general')
  })

  it('treats anything unrecognised as a general failure', () => {
    expect(classifyReplyFailure('Something odd happened', true)).toBe('general')
    expect(classifyReplyFailure('', true)).toBe('general')
  })
})

describe('REPLY_FAILURE_COPY', () => {
  it('has different short words for a lost connection and a busy moment', () => {
    expect(REPLY_FAILURE_COPY.offline).toMatch(/offline/i)
    expect(REPLY_FAILURE_COPY.busy).toMatch(/busy/i)
    expect(new Set(Object.values(REPLY_FAILURE_COPY)).size).toBe(3)
  })

  it('never carries a status code, an error name or blame', () => {
    for (const text of Object.values(REPLY_FAILURE_COPY)) {
      expect(text).not.toMatch(/\d{3}|HTTP|error|failed|invalid|your fault|you did/i)
      expect(text).toMatch(/try again/i)
    }
  })
})
