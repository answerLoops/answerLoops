import { describe, expect, it } from 'vitest'
import { reviewNoticeFor } from '@/lib/tickets/review-notice'

// The line under "needs human review" on a ticket's confidence card. It tells
// staff why nothing reached the customer.
describe('reviewNoticeFor', () => {
  it('explains the toggle for a Circle ticket like any other platform', () => {
    const notice = reviewNoticeFor({
      sourcePlatform: 'circle',
      autoDeflected: false,
      sourceIntegration: { auto_deflect_enabled: 0 },
    })
    expect(notice).toBe(
      'Automatic Deflections is off for circle — nothing was sent to the customer. Approve and send the draft below, or reply manually.'
    )
  })

  it('says nothing for a Circle ticket once its integration is disconnected', () => {
    expect(reviewNoticeFor({ sourcePlatform: 'circle', autoDeflected: false, sourceIntegration: null })).toBeNull()
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

  it('says nothing for a ticket with no integration row', () => {
    expect(reviewNoticeFor({ sourcePlatform: 'slack', autoDeflected: false, sourceIntegration: null })).toBeNull()
  })

  it('says nothing once the answer was sent automatically', () => {
    expect(
      reviewNoticeFor({ sourcePlatform: 'slack', autoDeflected: true, sourceIntegration: { auto_deflect_enabled: 0 } })
    ).toBeNull()
  })
})
