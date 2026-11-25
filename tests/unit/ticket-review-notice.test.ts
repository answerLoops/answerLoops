import { describe, expect, it } from 'vitest'
import { reviewNoticeFor } from '@/lib/tickets/review-notice'
import { isIngestOnlyPlatform } from '@/lib/channels/ingest-only'

// The line under "needs human review" on a ticket's confidence card. It tells
// staff why nothing reached the customer. For an ingest-only channel that
// depends on the ticket's own source, not on whether the integration is still
// connected, so a ticket from a disconnected Circle community keeps it.
describe('reviewNoticeFor', () => {
  it('shows the copy-by-hand notice for a Circle ticket after the integration is disconnected', () => {
    const notice = reviewNoticeFor({ sourcePlatform: 'circle', autoDeflected: false, sourceIntegration: null })
    expect(notice).toBe('answerLoops doesn\'t post in Circle. Copy the draft below and paste it into Circle by hand.')
  })

  it('shows the same notice for a Circle ticket while the integration is connected', () => {
    const notice = reviewNoticeFor({
      sourcePlatform: 'circle',
      autoDeflected: false,
      sourceIntegration: { auto_deflect_enabled: 0 },
    })
    expect(notice).toBe('answerLoops doesn\'t post in Circle. Copy the draft below and paste it into Circle by hand.')
  })

  it('explains the toggle for a platform whose Automatic Deflections is off', () => {
    const notice = reviewNoticeFor({
      sourcePlatform: 'slack',
      autoDeflected: false,
      sourceIntegration: { auto_deflect_enabled: 0 },
    })
    expect(notice).toBe(
      'Automatic Deflections is off for slack — nothing was sent to the customer. Approve and send the draft below, or reply manually.'
    )
  })

  it('says nothing when the toggle is on, since the low score alone explains the hold', () => {
    expect(
      reviewNoticeFor({ sourcePlatform: 'slack', autoDeflected: false, sourceIntegration: { auto_deflect_enabled: 1 } })
    ).toBeNull()
  })

  it('says nothing for a non-Circle ticket with no integration row', () => {
    expect(reviewNoticeFor({ sourcePlatform: 'slack', autoDeflected: false, sourceIntegration: null })).toBeNull()
  })

  it('says nothing once the answer was sent automatically', () => {
    expect(
      reviewNoticeFor({ sourcePlatform: 'slack', autoDeflected: true, sourceIntegration: { auto_deflect_enabled: 0 } })
    ).toBeNull()
  })
})

describe('isIngestOnlyPlatform', () => {
  it('is true only for Circle', () => {
    expect(isIngestOnlyPlatform('circle')).toBe(true)
    for (const p of ['discord', 'slack', 'telegram', 'discourse', 'email', 'github', 'google_chat', 'mcp', null, undefined]) {
      expect(isIngestOnlyPlatform(p)).toBe(false)
    }
  })
})
