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
    expect(s).toMatch(/import \{[^}]*\bcountArticleUsage\b[^}]*\} from '@\/lib\/kb\/usage'/)
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

describe('where answer sources are recorded', () => {
  const sources = /recordAnswerSources\(\{[^}]*\}\)/g
  const calls = (s: string) => s.match(sources) ?? []

  it('widget chat records after the reply, beside the usage count, and on a failed stream', () => {
    const s = readSrc('app/api/widget/chat/route.ts')
    expect(s).toMatch(/import \{[^}]*\brecordAnswerSources\b[^}]*\} from '@\/lib\/kb\/usage'/)
    const onFinish = s.slice(s.indexOf('onFinish: async (event)'))
    const counted = onFinish.indexOf('countArticleUsage(org.id, allContext)')
    const recorded = onFinish.indexOf("recordAnswerSources({ orgId: org.id, answerId, surface: 'widget', outcome: 'generated', context: allContext })")
    expect(recorded).toBeGreaterThan(counted)
    // a failed stream records the same context with the failed outcome
    const onError = s.slice(s.indexOf('onError: async'), s.indexOf('onFinish: async (event)'))
    expect(onError).toContain("surface: 'widget', outcome: 'failed', context: allContext")
    // both record the whole context that was supplied, nothing else
    expect(calls(s)).toHaveLength(2)
  })

  it('widget chat makes one answer id per generation, before streaming starts', () => {
    const s = readSrc('app/api/widget/chat/route.ts')
    const made = s.indexOf('const answerId = newAnswerId()')
    expect(made).toBeGreaterThan(-1)
    expect(made).toBeLessThan(s.indexOf('widgetAgent.stream('))
    // never created inside a callback, which a repeat would re-run
    expect(s.match(/newAnswerId\(\)/g)).toHaveLength(1)
  })

  it('slash /ask records after the answer, and records a failure but not a missing AI provider', () => {
    const s = readSrc('app/api/slash/ask/route.ts')
    const counted = s.indexOf('await countArticleUsage(orgId, kbArticleIds)')
    const generated = s.indexOf("surface: 'discord', outcome: 'generated', context: kbArticleIds")
    expect(generated).toBeGreaterThan(counted)
    const noProvider = s.indexOf('err instanceof NoAIProviderConfiguredError')
    const failed = s.indexOf("surface: 'discord', outcome: 'failed', context: kbArticleIds")
    expect(failed).toBeGreaterThan(noProvider)
    expect(s.indexOf('const answerId = newAnswerId()')).toBeLessThan(s.indexOf('askAgent.generate('))
    expect(calls(s)).toHaveLength(2)
  })

  it('generate_answer records after the answer, and records a failure but not a missing AI provider', () => {
    const s = readSrc('lib/agent/core.ts')
    const counted = s.indexOf('await countArticleUsage(orgId, groundingContext)')
    const generated = s.indexOf("surface: 'agent_api', outcome: 'generated', context: groundingContext")
    expect(generated).toBeGreaterThan(counted)
    const noProvider = s.indexOf('e instanceof NoAIProviderConfiguredError')
    const failed = s.indexOf("surface: 'agent_api', outcome: 'failed', context: groundingContext")
    expect(failed).toBeGreaterThan(noProvider)
    expect(s.indexOf('const answerId = newAnswerId()')).toBeLessThan(s.indexOf('answerAgent.generate(question)'))
    expect(calls(s)).toHaveLength(2)
  })

  it('ticket drafts record once the draft is saved, never for bug reports or feature requests', () => {
    const s = readSrc('lib/ai/agent.ts')
    const saved = s.indexOf('await updateTicketAIDraft(ticketId, text)', s.indexOf('supportAgent.generate('))
    const counted = s.indexOf('await countArticleUsage(orgId, priorAnswers)')
    const generated = s.indexOf("surface: 'ticket', outcome: 'generated', context: priorAnswers")
    expect(generated).toBeGreaterThan(counted)
    expect(counted).toBeGreaterThan(saved)
    // Everything before the KB-grounded generation is the bug / feature-request path.
    const earlyReturn = s.indexOf("category === 'bug' || category === 'feature_request'")
    expect(generated).toBeGreaterThan(earlyReturn)
    expect(s.indexOf('const answerId = newAnswerId()')).toBeGreaterThan(earlyReturn)
    // The failure is recorded in the answer path's catch, after the missing-provider branch.
    const noProvider = s.indexOf('err instanceof NoAIProviderConfiguredError', generated)
    const failed = s.indexOf("surface: 'ticket', outcome: 'failed', context: priorAnswers")
    expect(failed).toBeGreaterThan(noProvider)
    expect(calls(s)).toHaveLength(2)
  })

  it('search-only and simulation surfaces record nothing', () => {
    for (const file of ['app/api/kb/search/route.ts', 'app/api/simulation/run/route.ts']) {
      const s = readSrc(file)
      expect(s).not.toContain('recordAnswerSources')
      expect(s).not.toContain('recordAnswerReferences')
    }
    const core = readSrc('lib/agent/core.ts')
    const searchFn = core.slice(core.indexOf('export async function searchKbCore'), core.indexOf('// ── get_faq'))
    expect(searchFn).not.toContain('recordAnswerSources')
  })

  it('every call site that records an answer also keeps counting usage, unchanged', () => {
    for (const file of ['app/api/widget/chat/route.ts', 'app/api/slash/ask/route.ts', 'lib/agent/core.ts', 'lib/ai/agent.ts']) {
      expect(readSrc(file), file).toContain('countArticleUsage(')
    }
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
