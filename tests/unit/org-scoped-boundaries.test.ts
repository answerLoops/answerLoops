import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Regression guards for the fix/require-explicit-org-id branch, covering the
// boundaries NOT already pinned by tenant-isolation.test.ts /
// tenant-isolation-regressions.test.ts (which cover GitHub, push, widget chat,
// ticket detail, embeddings, SLA) and no-default-org.test.ts (which bans the
// `= DEFAULT_ORG_ID` default-parameter pattern in lib/ generically).
//
// These files previously called lib queries with no orgId argument, so every
// tenant silently read org 1's data. Each assertion pins the fix: the boundary
// resolves the org from the session (401 where the route requires auth) and
// threads that orgId into every query it calls.
//
// Source-file structural assertions — vitest cannot import Next.js route
// modules. Same convention as tenant-isolation.test.ts.

const ROOT = process.cwd()

function read(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('GET /api/analytics authenticates and scopes every query by session org', () => {
  it('authenticates via auth() and returns 401 without a session', () => {
    const src = read('app/api/analytics/route.ts')
    expect(src).toContain('await auth()')
    expect(src).toMatch(/if \(!session\?\.user\) return Response\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  })

  it('resolves orgId from the session before querying', () => {
    const src = read('app/api/analytics/route.ts')
    expect(src).toContain('const orgId = session.orgId ?? DEFAULT_ORG_ID')
  })

  it('passes orgId to all eight analytics queries', () => {
    const src = read('app/api/analytics/route.ts')
    expect(src).toContain('getDeflectionStats(orgId)')
    expect(src).toContain('getDeflectionTrend(14, orgId)')
    expect(src).toContain('getCategoryBreakdown(orgId)')
    expect(src).toContain('getDocGaps(20, orgId)')
    expect(src).toContain('getSLAStats(orgId)')
    expect(src).toContain('getDeflectionAccuracyByCategory(orgId)')
    expect(src).toContain('getCsatStats(orgId)')
    // No analytics query may be invoked without an org argument
    expect(src).not.toMatch(/get(DeflectionStats|CategoryBreakdown|SLAStats|DeflectionAccuracyByCategory|CsatStats)\(\)/)
  })
})

describe('GET /api/faq authenticates and scopes by session org', () => {
  it('authenticates via auth() and returns 401 without a session', () => {
    const src = read('app/api/faq/route.ts')
    expect(src).toContain('await auth()')
    expect(src).toMatch(/if \(!session\?\.user\) return Response\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  })

  it('passes the session org to getLatestFAQ', () => {
    const src = read('app/api/faq/route.ts')
    expect(src).toContain('getLatestFAQ(session.orgId ?? DEFAULT_ORG_ID)')
    expect(src).not.toMatch(/getLatestFAQ\(\)/)
  })
})

describe('POST /api/faq/generate threads the session org through generation', () => {
  it('authenticates, 401s without a session, and scopes the ticket read', () => {
    const src = read('app/api/faq/generate/route.ts')
    expect(src).toContain('await auth()')
    expect(src).toMatch(/if \(!session\?\.user\) return Response\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
    expect(src).toContain('getResolvedTicketsThisWeek(orgId)')
  })

  it('insertFAQSnapshot receives the orgId (snapshot must land in the caller org)', () => {
    const src = read('app/api/faq/generate/route.ts')
    expect(src).toMatch(/insertFAQSnapshot\([\s\S]*?tickets\.length,\s*orgId\s*\)/)
  })
})

describe('GET /api/tickets authenticates and scopes by session org', () => {
  it('authenticates via auth() and returns 401 without a session', () => {
    const src = read('app/api/tickets/route.ts')
    expect(src).toContain('await auth()')
    expect(src).toMatch(/if \(!session\?\.user\) return Response\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  })

  it('passes the session orgId to getTickets', () => {
    const src = read('app/api/tickets/route.ts')
    expect(src).toContain('const orgId = session.orgId ?? DEFAULT_ORG_ID')
    expect(src).toMatch(/getTickets\(\{[\s\S]*?\}, orgId\)/)
  })
})

describe('Notification queries are org-scoped', () => {
  // app/actions/notifications.ts (markReadAction/markAllReadAction) was removed
  // as dead code: notification-bell.tsx never wired up a "mark read" control,
  // so nothing called it. markNotificationRead/markAllNotificationsRead below
  // are themselves now unused for the same reason — kept for when the bell
  // grows that control, not because anything calls them today.

  it('markNotificationRead requires orgId and filters the update on notifications.orgId', () => {
    const src = read('lib/db/queries/notifications.ts')
    expect(src).toContain('markNotificationRead(id: number, orgId: number)')
    const body = src.slice(src.indexOf('function markNotificationRead'))
    expect(body.slice(0, 300)).toMatch(/and\(eq\(notifications\.id, id\), eq\(notifications\.orgId, orgId\)\)/)
  })
})

describe('Dashboard surfaces thread the session org into their queries', () => {
  it('analytics page passes orgId to its stats and CSAT queries', () => {
    const src = read('app/(dashboard)/analytics/page.tsx')
    expect(src).toContain('await auth()')
    expect(src).toContain('getDeflectionStats(orgId)')
    expect(src).toContain('getDocGaps(20, orgId)')
    expect(src).toContain('getCsatStats(orgId)')
  })

  it('dashboard page passes orgId to ticket stats and lists', () => {
    const src = read('app/(dashboard)/dashboard/page.tsx')
    expect(src).toContain('const orgId = session?.orgId ?? DEFAULT_ORG_ID')
    expect(src).toContain('getTicketStats(orgId)')
    expect(src).toContain('getSLABreachedTickets(orgId)')
    expect(src).toMatch(/getTickets\(\{ status: 'open' \}, orgId\)/)
  })

  it('dashboard layout scopes the unread badge count to the session org', () => {
    const src = read('app/(dashboard)/layout.tsx')
    expect(src).toContain('const orgId = session?.orgId ?? DEFAULT_ORG_ID')
    expect(src).toContain('getUnreadCount(orgId)')
    expect(src).not.toMatch(/getUnreadCount\(\)/)
  })

  it('tickets page passes the session orgId to getTickets', () => {
    const src = read('app/(dashboard)/tickets/page.tsx')
    expect(src).toContain('const orgId = session?.orgId ?? DEFAULT_ORG_ID')
    expect(src).toMatch(/getTickets\(\{[\s\S]*?\}, orgId\)/)
  })
})
