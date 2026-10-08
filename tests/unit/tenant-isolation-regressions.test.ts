import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Regression guards for the tenant-isolation branch that are NOT covered by
// tenant-isolation.test.ts:
//
//  1. GET /api/tickets/[id] must await its DB reads — a prior bug returned
//     bare promises which JSON-serialize as {} (empty replies/events/assessment
//     in the API response, silently green).
//  2. The public widget chat route authenticates by widget token (no session,
//     no DEFAULT_ORG_ID fallback) and threads org.id into every AI/KB lookup.
//  3. The ingest pipeline passes orgId to the dedupe lookup and the AI agent.
//
// Source-file structural assertions — vitest cannot import Next.js route
// modules. Same convention as tenant-isolation.test.ts.

const ROOT = process.cwd()

function read(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('GET /api/tickets/[id] awaits its DB reads', () => {
  it('resolves the ticket before responding', () => {
    const src = read('app/api/tickets/[id]/route.ts')
    expect(src).toContain('const ticket = await getTicketById(ticketId, orgId)')
  })

  it('awaits replies, events, and assessment via Promise.all (promises serialize as {} otherwise)', () => {
    const src = read('app/api/tickets/[id]/route.ts')
    expect(src).toMatch(
      /const \[replies, events, assessment\] = await Promise\.all\(\[\s*getTicketReplies\(ticketId\),\s*getTicketEvents\(ticketId\),\s*getAssessment\(ticketId\),?\s*\]\)/
    )
  })
})

describe('Widget chat route authenticates by widget token and scopes by org', () => {
  it('rejects requests without a widget token and resolves the org from it', () => {
    const src = read('app/api/widget/chat/route.ts')
    expect(src).toContain('Missing widgetToken')
    expect(src).toContain('const org = await getOrgByWidgetToken(widgetToken)')
    expect(src).toContain("'Invalid widget token'")
  })

  it('never falls back to a session or DEFAULT_ORG_ID (public endpoint)', () => {
    const src = read('app/api/widget/chat/route.ts')
    expect(src).not.toContain('DEFAULT_ORG_ID')
    expect(src).not.toContain('await auth()')
  })

  it('threads org.id into every lookup it makes', () => {
    const src = read('app/api/widget/chat/route.ts')
    // Retrieval is one helper taking the org id; both the embedding (cached per
    // org — see lib/widget/embed-cache.ts) and the KB search are scoped by it.
    expect(src).toContain('retrieveContext(query, org.id)')
    expect(src).toContain('embedQueryCached(query, orgId)')
    // The article count is a named constant rather than a literal now, so this
    // asserts the org argument is threaded rather than pinning the number —
    // the org scoping is the property under test, the budget is not.
    expect(src).toMatch(/getKBContext\(vector, [A-Z_]+, orgId\)/)
    expect(src).toContain("chatModel(DEFAULT_FAST_MODEL, org.id)")
    // The prior-answer lookup used to be asserted here. The widget no longer
    // reads ticket-derived context at all (see tests/unit/widget-kb-only-context
    // .test.ts) — resolution notes are written for one recipient and must not
    // reach an anonymous visitor. Its org scoping is still covered where that
    // lookup still happens, in the internal draft pipeline.
    // Comments stripped: the route's own comment names the removed helper to
    // explain why it is gone, which would otherwise trip this.
    expect(src.replace(/\/\/.*$/gm, '')).not.toContain('getPriorAnswers')
  })
})

describe('Ingest pipeline threads orgId into dedupe and the AI agent', () => {
  it('dedupe lookup is scoped by org (message IDs can collide across platforms)', () => {
    const src = read('lib/ingest/pipeline.ts')
    expect(src).toContain('getTicketBySourceMessageId(messageId, orgId)')
  })

  it('runAIAgent receives the pipeline orgId', () => {
    const src = read('lib/ingest/pipeline.ts')
    expect(src).toMatch(
      /runAIAgent\(ticketId, content, threadId \?\? channelId, priorAnswers, orgId, platform, category \?\? 'general_question', duplicates, orgTicketNumber, aiPurpose, channelId, threadId\)/
    )
  })

  it('KB context and prior answers are looked up within the org', () => {
    const src = read('lib/ingest/pipeline.ts')
    expect(src).toContain('getKBContext(vector, 3, orgId)')
    expect(src).toContain('getPriorAnswers(related.map((m) => m.related_id), orgId)')
  })
})
