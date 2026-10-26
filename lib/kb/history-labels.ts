import type { KBArticleEventOrigin, KBArticleEventType, KBArticleHistoryEntry } from '@/types'

/**
 * The words the dashboard uses for one history entry. Kept free of server
 * imports so the history panel (a client component) can use it.
 */
export interface HistoryLabels {
  /** What happened. */
  title: string
  /** Who did it, or what did it automatically. Never a person's name for an import or a sync. */
  actor: string
  /** Where it came from, as a short tag. */
  origin: string
  /** True for imports and syncs, which are never shown as a person. */
  automated: boolean
}

const ORIGIN_TAG: Record<KBArticleEventOrigin, string> = {
  manual: 'By hand',
  ticket_promotion: 'From a ticket',
  review_queue: 'Review queue',
  import: 'Import',
  sync: 'Sync',
}

function title(type: KBArticleEventType, origin: KBArticleEventOrigin): string {
  switch (type) {
    case 'created':
      if (origin === 'import') return 'Created by an import'
      if (origin === 'sync') return 'Created by a sync'
      return 'Added by hand'
    case 'promoted':
      return 'Promoted from a ticket'
    case 'edited':
      if (origin === 'ticket_promotion') return 'Refreshed from a ticket'
      if (origin === 'sync') return 'Updated by a sync'
      if (origin === 'import') return 'Updated by an import'
      return 'Edited'
    case 'review_approved':
      return 'Approved from the review queue'
    case 'review_rejected':
      return 'Rejected in the review queue'
    case 'review_reopened':
      return 'Moved back to review'
    case 'verified':
      return 'Verified'
    default:
      return 'Changed'
  }
}

export function describeHistoryEntry(
  entry: Pick<KBArticleHistoryEntry, 'type' | 'origin' | 'actor_user_id' | 'actor_name'>
): HistoryLabels {
  const origin = ORIGIN_TAG[entry.origin] ?? 'Unknown'
  const automated = entry.origin === 'import' || entry.origin === 'sync'

  let actor: string
  if (automated) {
    actor = entry.origin === 'import' ? 'Imported' : 'Synced'
  } else if (entry.actor_name) {
    actor = entry.actor_name
  } else if (entry.actor_user_id != null) {
    // A user row exists but has neither a name nor an email to show.
    actor = 'Team member'
  } else if (entry.origin in ORIGIN_TAG) {
    // Every action by a person records who did it, so a missing actor here
    // means the user has since been deleted.
    actor = 'Former team member'
  } else {
    actor = 'Unknown'
  }

  return { title: title(entry.type, entry.origin), actor, origin, automated }
}
