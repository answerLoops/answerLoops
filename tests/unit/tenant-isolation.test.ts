import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Multi-tenant isolation guards. Every query that reads or mutates tenant data
// must be scoped by org_id, and every boundary (API route, server action, page)
// must resolve the org from the session — never from DEFAULT_ORG_ID fallbacks
// that silently point at org 1.
//
// Source-file structural assertions (vitest cannot import Next.js route
// modules) — same convention as infra-channel-routes.test.ts. Each assertion
// pins a fix for a confirmed cross-tenant leak; removing the org scoping from
// any of these files should fail this suite.

const ROOT = process.cwd()

function read(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('GitHub repo queries are org-scoped', () => {
  it('getRepos requires an orgId (no DEFAULT_ORG_ID fallback)', () => {
    const src = read('lib/db/queries/github.ts')
    expect(src).toContain('export async function getRepos(orgId: number)')
    expect(src).not.toContain('orgId = DEFAULT_ORG_ID')
  })

  it('removeRepo deletes only within the caller org', () => {
    const src = read('lib/db/queries/github.ts')
    expect(src).toMatch(/removeRepo\(id: number, orgId: number\)/)
    const removeBody = src.slice(src.indexOf('function removeRepo'))
    expect(removeBody.slice(0, 300)).toContain('githubRepos.orgId, orgId')
  })

  it('addRepo scopes its upsert lookup by org', () => {
    const src = read('lib/db/queries/github.ts')
    const addBody = src.slice(src.indexOf('function addRepo'), src.indexOf('function removeRepo'))
    expect(addBody).toContain('orgId: number')
    expect(addBody).toContain('eq(githubRepos.orgId, orgId)')
  })

  it('toRepo exposes org_id so callers can verify ownership', () => {
    const src = read('lib/db/queries/github.ts')
    expect(src).toContain('org_id: row.orgId')
  })
})

describe('GitHub app + agent tools thread orgId', () => {
  it('getInstallationOctokit and getConfiguredRepos require orgId', () => {
    const src = read('lib/github/app.ts')
    expect(src).toContain('getInstallationOctokit(owner: string, repo: string, orgId: number)')
    expect(src).toContain('getConfiguredRepos(orgId: number)')
  })

  it('code-search tools require orgId', () => {
    const src = read('lib/github/tools.ts')
    expect(src).toContain('searchCode(query: string, repo: string, orgId: number)')
    expect(src).toContain("readFile(path: string, repo: string, orgId: number, ref = 'main')")
    expect(src).toContain('listFiles(path: string, repo: string, orgId: number)')
  })

  it('AI agent passes its orgId to repo lookup and every tool', () => {
    const src = read('lib/ai/agent.ts')
    expect(src).toContain('getConfiguredRepos(orgId)')
    expect(src).toContain('searchCode(input.query, input.repo, orgId)')
    expect(src).toContain('readFile(input.path, input.repo, orgId, input.ref)')
    expect(src).toContain('listFiles(input.path, input.repo, orgId)')
  })
})

describe('GitHub repo API routes enforce session org', () => {
  it('GET /api/github/repos authenticates and scopes by session org', () => {
    const src = read('app/api/github/repos/route.ts')
    expect(src).toContain('await auth()')
    expect(src).toContain('getRepos(orgId)')
  })

  it('DELETE /api/github/repos/[id] authenticates, awaits, and scopes the delete', () => {
    const src = read('app/api/github/repos/[id]/route.ts')
    expect(src).toContain('await auth()')
    expect(src).toContain('await removeRepo(Number(id), orgId)')
  })

  it('repo connect/remove routes authenticate and pass the session org', () => {
    const connectSrc = read('app/api/github/connect-installation/route.ts')
    expect(connectSrc).toContain('await auth()')
    expect(connectSrc).toMatch(/await addRepo\([^)]*orgId\)/)

    const removeSrc = read('app/api/github/repos/[id]/route.ts')
    expect(removeSrc).toContain('await auth()')
    expect(removeSrc).toMatch(/await removeRepo\(Number\(id\), orgId\)/)
  })

  it('GitHub webhook resolves org from the repo row, not a re-fetch of org 1', () => {
    const src = read('app/api/github/webhook/route.ts')
    expect(src).toContain('dbRepo.org_id')
    expect(src).not.toContain('getRepos()')
  })
})

describe('Push notifications are org-scoped', () => {
  it('sendPushToAll filters subscriptions by orgId', () => {
    const src = read('lib/push/notify.ts')
    expect(src).toContain('sendPushToAll(payload: PushPayload, orgId: number)')
    expect(src).toContain('eq(pushSubscriptions.orgId, orgId)')
  })

  it('subscribe route stamps the session org onto the subscription', () => {
    const src = read('app/api/push/subscribe/route.ts')
    expect(src).toContain('await auth()')
    expect(src).toMatch(/values\(\{ orgId,/)
  })

  it('ingest pipeline passes orgId to sendPushToAll', () => {
    const src = read('lib/ingest/pipeline.ts')
    expect(src).toMatch(/sendPushToAll\(\{[\s\S]*?\}, orgId\)/)
  })
})

describe('Ticket queries are org-scoped at boundaries', () => {
  it('getTicketById requires orgId and filters on it', () => {
    const src = read('lib/db/queries/tickets.ts')
    expect(src).toContain('getTicketById(id: number, orgId: number)')
    const body = src.slice(src.indexOf('function getTicketById'))
    expect(body.slice(0, 300)).toContain('eq(tickets.orgId, orgId)')
  })

  it('getTicketByOrgTicketNumber requires orgId and filters on it (org_ticket_number restarts at 1 per org)', () => {
    const src = read('lib/db/queries/tickets.ts')
    expect(src).toContain('getTicketByOrgTicketNumber(orgTicketNumber: number, orgId: number)')
    const body = src.slice(src.indexOf('function getTicketByOrgTicketNumber'))
    expect(body.slice(0, 300)).toContain('eq(tickets.orgId, orgId)')
  })

  it('getTicketBySourceMessageId requires orgId (cross-platform message IDs can collide)', () => {
    const src = read('lib/db/queries/tickets.ts')
    expect(src).toContain('getTicketBySourceMessageId(messageId: string, orgId: number)')
  })

  it('ticket detail page resolves session org before loading the ticket', () => {
    const src = read('app/(dashboard)/tickets/[id]/page.tsx')
    // The URL segment is the org-local org_ticket_number (see
    // tests/unit/org-ticket-numbers.test.ts), so lookup must be scoped by
    // both orgTicketNumber AND orgId — otherwise org A could guess org B's
    // ticket numbers (which restart at 1 for every org).
    expect(src).toContain('getTicketByOrgTicketNumber(Number(id), orgId)')
    expect(src).toContain('getRelatedTickets(ticket.id, orgId)')
    expect(src).toContain('getOrgMembers(orgId)')
    expect(src).not.toContain('getOrgMembers(DEFAULT_ORG_ID)')
  })

  it('GET/DELETE /api/tickets/[id] authenticate and scope by session org', () => {
    const src = read('app/api/tickets/[id]/route.ts')
    const gets = src.match(/getTicketById\(ticketId, orgId\)/g) ?? []
    expect(gets.length).toBe(2)
    expect(src).toContain('getOrgMembers(orgId)')
  })

  it('ticket server actions verify org ownership before mutating', () => {
    const src = read('app/actions/tickets.ts')
    const scoped = src.match(/getTicketById\(ticketId, orgId\)/g) ?? []
    expect(scoped.length).toBeGreaterThanOrEqual(3)
    // GitHub reply posting (postReplyAction, approve, and edit all route
    // through the shared postReplyToGithub in lib/channels/post-reply.ts as
    // of the Automatic Deflections toggle) must confirm the repo belongs to
    // the caller org — checked once in the shared module rather than 3x
    // duplicated per call site.
    const shared = read('lib/channels/post-reply.ts')
    const orgChecks = shared.match(/repoRecord\.org_id !== orgId/g) ?? []
    expect(orgChecks.length).toBe(1)
  })

  it('KB promote action loads the ticket within the session org', () => {
    const src = read('app/actions/kb.ts')
    expect(src).toContain('getTicketById(parsed.data.ticketId, orgId)')
  })
})

describe('Semantic search + SLA are org-scoped', () => {
  it('getCandidateVectors joins tickets and filters by org', () => {
    const src = read('lib/db/queries/embeddings.ts')
    expect(src).toContain('getCandidateVectors(excludeTicketId: number, orgId: number)')
    expect(src).toContain('eq(tickets.orgId, orgId)')
  })

  it('getRelatedTickets filters related rows by org', () => {
    const src = read('lib/db/queries/embeddings.ts')
    expect(src).toContain('getRelatedTickets(ticketId: number, orgId: number)')
    const body = src.slice(src.indexOf('function getRelatedTickets'))
    expect(body.slice(0, 500)).toContain('t.org_id = ${orgId}')
  })

  it('checkSlaBreaches scopes updates and selects by org', () => {
    const src = read('lib/sla/engine.ts')
    expect(src).toContain('checkSlaBreaches(orgId: number)')
    const body = src.slice(src.indexOf('function checkSlaBreaches'))
    const orgFilters = body.match(/org_id = \$\{orgId\}/g) ?? []
    expect(orgFilters.length).toBe(3)
  })

  it('pipeline passes orgId to candidate lookups', () => {
    const pipeline = read('lib/ingest/pipeline.ts')
    expect(pipeline).toContain('getCandidateVectors(ticketId, orgId)')
    expect(pipeline).toContain('checkSlaBreaches(orgId)')
    // The widget was asserted here too, until it stopped doing candidate
    // lookups entirely — it grounds answers in published KB articles only, so
    // ticket-derived text cannot reach an anonymous visitor. Its remaining
    // lookups are org-scoped and covered in tenant-isolation-regressions.
    const widget = read('app/api/widget/chat/route.ts')
    expect(widget.replace(/\/\/.*$/gm, '')).not.toContain('getCandidateVectors')
  })
})
