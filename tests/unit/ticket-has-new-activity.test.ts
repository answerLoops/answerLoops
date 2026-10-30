// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { hasNewActivity } from '@/lib/tickets/activity'

describe('hasNewActivity', () => {
  it.each([
    ['no customer reply', null, null, false],
    ['no customer reply, but seen', null, '2026-10-02T00:00:00.000Z', false],
    ['reply and never seen', '2026-10-01T00:00:00.000Z', null, true],
    ['reply newer than seen', '2026-10-03T00:00:00.000Z', '2026-10-02T00:00:00.000Z', true],
    ['reply older than seen', '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z', false],
    ['reply equal to seen', '2026-10-02T00:00:00.000Z', '2026-10-02T00:00:00.000Z', false],
  ])('%s', (_name, reply, seen, expected) => {
    expect(hasNewActivity({ last_customer_reply_at: reply, last_seen_at: seen })).toBe(expected)
  })
})
