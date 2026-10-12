import { describe, expect, it } from 'vitest'
import {
  MAX_STREAMS_PER_ORG,
  MAX_STREAMS_PER_USER,
  acquireStreamSlot,
  streamCounts,
} from '@/lib/live-events-limits'

describe('SSE stream slots', () => {
  it('caps streams per user and frees a slot on release (once)', () => {
    const releases = Array.from({ length: MAX_STREAMS_PER_USER }, () => acquireStreamSlot('u-a', 900))
    expect(releases.every(Boolean)).toBe(true)
    expect(acquireStreamSlot('u-a', 900)).toBeNull()

    releases[0]!()
    releases[0]!() // second call must not free another slot
    expect(streamCounts('u-a', 900).user).toBe(MAX_STREAMS_PER_USER - 1)
    const again = acquireStreamSlot('u-a', 900)
    expect(again).not.toBeNull()
    expect(acquireStreamSlot('u-a', 900)).toBeNull()

    again!()
    releases.slice(1).forEach((r) => r!())
    expect(streamCounts('u-a', 900)).toEqual({ user: 0, org: 0 })
  })

  it('caps streams per org across different users', () => {
    const held: Array<() => void> = []
    for (let i = 0; i < MAX_STREAMS_PER_ORG; i++) {
      const r = acquireStreamSlot(`org-user-${i}`, 901)
      expect(r).not.toBeNull()
      held.push(r!)
    }
    expect(acquireStreamSlot('another-user', 901)).toBeNull()
    expect(acquireStreamSlot('another-user', 902)).not.toBeNull()
    held.forEach((r) => r())
    expect(streamCounts('another-user', 901).org).toBe(0)
  })
})
