import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { is } from 'drizzle-orm'
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core'

// Source-shape assertions on where article usage is counted, in the same style
// as the other wiring tests in this folder: the point is that every surface
// that answers from the knowledge base counts the articles it used, only after
// an answer exists, and that search-only surfaces do not.

const ROOT = process.cwd()
function readSrc(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

describe('knowledge-base retrieval keeps article ids', () => {
  it('getKBContext returns the article id with each entry', () => {
    const s = readSrc('lib/db/queries/kb.ts')
    const fn = s.slice(s.indexOf('export async function getKBContext'))
    expect(fn).toContain('articleId: a.id')
  })
})

describe('where usage is counted', () => {
  it('widget chat counts after the reply is delivered, beside billing', () => {
    const s = readSrc('app/api/widget/chat/route.ts')
    expect(s).toMatch(/import \{ countArticleUsage \} from '@\/lib\/kb\/usage'/)
    const onFinish = s.slice(s.indexOf('onFinish: async (event)'))
    const commitIdx = onFinish.indexOf('commitDeflection(')
    const countIdx = onFinish.indexOf('countArticleUsage(org.id, allContext)')
    expect(commitIdx).toBeGreaterThan(-1)
    expect(countIdx).toBeGreaterThan(commitIdx)
  })

  it('ticket drafts count once the draft is saved, not at retrieval', () => {
    const s = readSrc('lib/ai/agent.ts')
    const generated = s.indexOf('supportAgent.generate(')
    // The draft write that follows the KB-grounded generation (earlier
    // updateTicketAIDraft calls belong to the bug / feature-request path).
    const saved = s.indexOf('await updateTicketAIDraft(ticketId, text)', generated)
    const counted = s.indexOf('await countArticleUsage(orgId, priorAnswers)')
    expect(generated).toBeGreaterThan(-1)
    expect(counted).toBeGreaterThan(saved)
    expect(saved).toBeGreaterThan(generated)
    // Bug reports and feature requests return before any KB-grounded draft is
    // written, so they must not count.
    const earlyReturn = s.indexOf("category === 'bug' || category === 'feature_request'")
    expect(counted).toBeGreaterThan(earlyReturn)
  })

  it('slash /ask counts after the answer is generated and billed', () => {
    const s = readSrc('app/api/slash/ask/route.ts')
    const generated = s.indexOf('askAgent.generate(')
    const counted = s.indexOf('await countArticleUsage(orgId, kbArticleIds)')
    expect(generated).toBeGreaterThan(-1)
    expect(counted).toBeGreaterThan(generated)
  })

  it('generate_answer counts after the answer is generated, not on an AI-provider error', () => {
    const s = readSrc('lib/agent/core.ts')
    const generated = s.indexOf('answerAgent.generate(question)')
    const counted = s.indexOf('await countArticleUsage(orgId, groundingContext)')
    expect(generated).toBeGreaterThan(-1)
    expect(counted).toBeGreaterThan(generated)
  })

  it('search-only and simulation surfaces do not count', () => {
    for (const file of ['app/api/kb/search/route.ts', 'app/api/simulation/run/route.ts']) {
      expect(readSrc(file)).not.toContain('countArticleUsage')
    }
    // The search_kb tool hands matches to an outside agent; it is not an answer.
    const core = readSrc('lib/agent/core.ts')
    const searchFn = core.slice(core.indexOf('export async function searchKbCore'), core.indexOf('// ── get_faq'))
    expect(searchFn.length).toBeGreaterThan(0)
    expect(searchFn).not.toContain('countArticleUsage')
  })
})

describe('kb_article_usage table', () => {
  it('is declared in the schema with a per-article-per-day key and an org column', async () => {
    const schema = await import('@/lib/db/schema')
    const table = (Object.values(schema) as unknown[]).find(
      (v): v is PgTable => is(v, PgTable) && getTableConfig(v).name === 'kb_article_usage'
    )
    expect(table).toBeDefined()
    const cfg = getTableConfig(table!)
    expect(cfg.columns.map((c) => c.name).sort()).toEqual(['answers', 'article_id', 'day', 'org_id'])
    expect(cfg.primaryKeys[0].columns.map((c) => c.name).sort()).toEqual(['article_id', 'day'])
  })

  it('is created by a migration that cascades from articles and orgs and stores only counts', () => {
    const s = readSrc('drizzle/0055_kb_article_usage.sql')
    expect(s).toContain('CREATE TABLE IF NOT EXISTS kb_article_usage')
    expect(s).toMatch(/article_id INTEGER NOT NULL REFERENCES kb_articles\(id\) ON DELETE CASCADE/)
    expect(s).toMatch(/org_id INTEGER NOT NULL REFERENCES orgs\(id\) ON DELETE CASCADE/)
    expect(s).toContain('PRIMARY KEY (article_id, day)')
    // Counts only: no question text, visitor or ticket reference. Checked on
    // the statements, not the explanatory comments above them.
    const statements = s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    expect(statements).not.toMatch(/\b(question|visitor\w*|ticket_id|content)\b/i)
  })

  it('is cleared when a workspace is purged', () => {
    const s = readSrc('lib/db/queries/orgs.ts')
    const purge = s.slice(s.indexOf('export async function hardPurgeOrg'))
    expect(purge).toContain('delete(kbArticleUsage)')
  })
})
