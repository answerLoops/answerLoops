import { sql } from 'drizzle-orm'
import type { getDb } from './drizzle'

// Either a database or an open transaction; both can run this statement.
type Executor = Pick<ReturnType<typeof getDb>, 'execute'>

// Class half of the two-key advisory lock, keeping the per-workspace lock
// below separate from other advisory locks.
const TICKET_ACTIVITY_LOCK_CLASS = 619

/**
 * Takes the per-workspace ticket activity lock until the surrounding
 * transaction ends. Reply writers share it, so they never wait on each other.
 * Bulk clearing, ticket deletion and workspace purge take it exclusively, so
 * they wait for in-flight replies and hold new ones back until they finish.
 */
export async function lockTicketActivity(
  tx: Executor,
  orgId: number,
  mode: 'shared' | 'exclusive'
): Promise<void> {
  await tx.execute(
    mode === 'shared'
      ? sql`SELECT pg_advisory_xact_lock_shared(${TICKET_ACTIVITY_LOCK_CLASS}, ${orgId})`
      : sql`SELECT pg_advisory_xact_lock(${TICKET_ACTIVITY_LOCK_CLASS}, ${orgId})`
  )
}
