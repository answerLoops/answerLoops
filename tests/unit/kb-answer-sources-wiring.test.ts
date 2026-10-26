import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Source-shape checks on how the two answer-source views are wired, in the same
// style as the other wiring tests: who is allowed to trigger a read, where the
// ticket id is passed, and how the Knowledge Base links land on an article.

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')

describe('the ticket page reads sources only for owners and admins', () => {
  const s = read('app/(dashboard)/tickets/[id]/page.tsx')

  it('loads the sources only when the viewer may promote (owner or admin), never for a member', () => {
    expect(s).toContain("const canPromote = currentRole === 'owner' || currentRole === 'admin'")
    expect(s).toContain('const answerSources = canPromote ? await getAnswerSourcesForTicket(ticket.id, orgId) : null')
  })

  it('reads them once, from that one gated line', () => {
    expect(s.match(/getAnswerSourcesForTicket\(/g)).toHaveLength(1)
  })

  it('uses the workspace from the session, not from the request', () => {
    expect(s).toMatch(/getAnswerSourcesForTicket\(ticket\.id, orgId\)/)
  })

  it('shows the panel only when there are sources to show', () => {
    expect(s).toContain('{answerSources && <AnswerSourcesPanel data={answerSources} />}')
  })

  it('places the panel after the AI draft', () => {
    expect(s.indexOf('<AnswerSourcesPanel')).toBeGreaterThan(s.indexOf('<AIDraftPanel'))
  })
})

describe('the knowledge base list', () => {
  const s = read('app/(dashboard)/kb/page.tsx')

  it('shows the recent-answers control only for a viewer the list route said may see it', () => {
    expect(s).toContain("'can_view_answers' in a && a.can_view_answers && <ArticleAnswers articleId={a.id} />")
  })

  it('gives every article an anchor the Sources links can land on, and scrolls to it once the list has loaded', () => {
    expect(s).toContain('id={`article-${a.id}`}')
    expect(s).toMatch(/window\.location\.hash\.match\(\/\^#article-\(\\d\+\)\$\/\)/)
    expect(s).toContain('scrollIntoView')
  })
})

describe('the ticket id is passed only by the ticket path', () => {
  it('the ticket draft passes its ticket id for both outcomes', () => {
    const s = read('lib/ai/agent.ts')
    expect(s).toContain("recordAnswerSources({ orgId, answerId, ticketId, surface: 'ticket', outcome: 'generated', context: priorAnswers })")
    expect(s).toContain("recordAnswerSources({ orgId, answerId, ticketId, surface: 'ticket', outcome: 'failed', context: priorAnswers })")
  })

  it.each(['app/api/widget/chat/route.ts', 'app/api/slash/ask/route.ts', 'lib/agent/core.ts'])(
    '%s passes no ticket id',
    (file) => {
      expect(read(file)).not.toMatch(/recordAnswerSources\(\{[^}]*ticketId/)
    }
  )

  it('the query keeps a ticket id only for the ticket surface and only after checking the workspace', () => {
    const s = read('lib/db/queries/kb-answers.ts')
    expect(s).toContain("input.surface === 'ticket' && input.ticketId != null")
    expect(s).toMatch(/eq\(tickets\.orgId, input\.orgId\)/)
  })
})

describe('the answers route is for owners and admins', () => {
  it("asks for owner and admin access, and nothing else reads an article's answers", () => {
    expect(read('app/api/kb/articles/[id]/answers/route.ts')).toContain("requireOrgAccess(['owner', 'admin'])")
  })
})
