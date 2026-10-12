/**
 * Concurrent-stream accounting for app/api/events/stream/route.ts.
 *
 * Every open stream holds a dedicated Postgres connection for its LISTEN, so
 * the number of streams one user or one workspace can hold open is bounded
 * here. A normal user has a handful of tabs; the limits sit well above that.
 *
 * State is per process. On a multi-instance deployment each instance enforces
 * the limits independently, so the effective ceiling is the limit times the
 * instance count. Slots are always released when a stream closes (client
 * disconnect, recycle, heartbeat failure), so the maps cannot grow beyond the
 * set of currently open streams.
 */
export const MAX_STREAMS_PER_USER = 6
export const MAX_STREAMS_PER_ORG = 40

const perUser = new Map<string, number>()
const perOrg = new Map<number, number>()

function bump<K>(map: Map<K, number>, key: K, delta: number): void {
  const next = (map.get(key) ?? 0) + delta
  if (next <= 0) map.delete(key)
  else map.set(key, next)
}

/**
 * Reserve a slot for one stream. Returns a one-shot release function, or null
 * when either limit is already reached.
 */
export function acquireStreamSlot(userKey: string, orgId: number): (() => void) | null {
  if ((perUser.get(userKey) ?? 0) >= MAX_STREAMS_PER_USER) return null
  if ((perOrg.get(orgId) ?? 0) >= MAX_STREAMS_PER_ORG) return null
  bump(perUser, userKey, 1)
  bump(perOrg, orgId, 1)
  let released = false
  return () => {
    if (released) return
    released = true
    bump(perUser, userKey, -1)
    bump(perOrg, orgId, -1)
  }
}

/** Test hook: open stream counts for a user and an org. */
export function streamCounts(userKey: string, orgId: number): { user: number; org: number } {
  return { user: perUser.get(userKey) ?? 0, org: perOrg.get(orgId) ?? 0 }
}
