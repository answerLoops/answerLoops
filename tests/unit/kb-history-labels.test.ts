import { describe, it, expect } from 'vitest'
import { describeHistoryEntry } from '@/lib/kb/history-labels'
import type { KBArticleEventOrigin, KBArticleEventType } from '@/types'

const entry = (
  type: KBArticleEventType,
  origin: KBArticleEventOrigin,
  actor_user_id: number | null = null,
  actor_name: string | null = null
) => ({ type, origin, actor_user_id, actor_name })

describe('describeHistoryEntry titles', () => {
  it.each<[KBArticleEventType, KBArticleEventOrigin, string]>([
    ['created', 'manual', 'Added by hand'],
    ['created', 'import', 'Created by an import'],
    ['created', 'sync', 'Created by a sync'],
    ['promoted', 'ticket_promotion', 'Promoted from a ticket'],
    ['edited', 'ticket_promotion', 'Refreshed from a ticket'],
    ['edited', 'sync', 'Updated by a sync'],
    ['edited', 'import', 'Updated by an import'],
    ['edited', 'manual', 'Edited'],
    ['review_approved', 'review_queue', 'Approved from the review queue'],
    ['review_rejected', 'review_queue', 'Rejected in the review queue'],
    ['review_reopened', 'review_queue', 'Moved back to review'],
    ['verified', 'manual', 'Verified'],
  ])('%s from %s reads "%s"', (type, origin, title) => {
    expect(describeHistoryEntry(entry(type, origin, 5, 'Dana')).title).toBe(title)
  })
})

describe('describeHistoryEntry who did it', () => {
  it('shows a person by name', () => {
    expect(describeHistoryEntry(entry('verified', 'manual', 12, 'Dana'))).toMatchObject({
      actor: 'Dana',
      automated: false,
    })
  })

  it('shows an import as an import and a sync as a sync, never as a person', () => {
    expect(describeHistoryEntry(entry('created', 'import'))).toMatchObject({ actor: 'Imported', automated: true })
    expect(describeHistoryEntry(entry('edited', 'sync'))).toMatchObject({ actor: 'Synced', automated: true })
  })

  it('does not show a name on an automated entry even if one is present', () => {
    expect(describeHistoryEntry(entry('edited', 'sync', 12, 'Dana')).actor).toBe('Synced')
  })

  it('says former team member when a person-driven event has no actor left', () => {
    expect(describeHistoryEntry(entry('created', 'manual'))).toMatchObject({
      actor: 'Former team member',
      automated: false,
    })
    expect(describeHistoryEntry(entry('review_approved', 'review_queue')).actor).toBe('Former team member')
  })

  it('does not call a person unknown when a user exists but has no name to show', () => {
    expect(describeHistoryEntry(entry('verified', 'manual', 12, null)).actor).toBe('Team member')
  })

  it('falls back to unknown for an origin it does not recognise', () => {
    const odd = entry('verified', 'something_new' as KBArticleEventOrigin)
    expect(describeHistoryEntry(odd)).toMatchObject({ actor: 'Unknown', origin: 'Unknown' })
  })
})

describe('describeHistoryEntry origin tag', () => {
  it.each<[KBArticleEventOrigin, string]>([
    ['manual', 'By hand'],
    ['ticket_promotion', 'From a ticket'],
    ['review_queue', 'Review queue'],
    ['import', 'Import'],
    ['sync', 'Sync'],
  ])('%s is tagged "%s"', (origin, tag) => {
    expect(describeHistoryEntry(entry('created', origin)).origin).toBe(tag)
  })
})
