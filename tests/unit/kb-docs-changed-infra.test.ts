import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { kbArticles } from '@/lib/db/schema'

/**
 * Infrastructure coverage for docs-changed flagging: migration 0075 under the
 * runner, schema/SQL agreement, the statements swapKBSource emits with and
 * without flagRelatedResolutions, and failure isolation of the flagging step.
 */

type Call = { sql: string; params: unknown[] }
const { calls, responses, failOn } = vi.hoisted(() => ({
  calls: [] as Call[],
  responses: [] as Array<Array<unknown>>,
  failOn: { match: null as string | null },
}))

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/db/drizzle', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  const db = drizzle(async (sqlText: string, params: unknown[]) => {
    calls.push({ sql: sqlText, params })
    if (failOn.match && sqlText.includes(failOn.match)) throw new Error('simulated failure')
    return { rows: responses.shift() ?? [] }
  })
  // pg-proxy has no transactions; both the outer transaction and the savepoint
  // run their callback against the same recording client.
  const wrapped: typeof db = Object.assign(Object.create(db), {
    transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => fn(wrapped),
  })
  return { getDb: () => wrapped }
})

const ROOT = process.cwd()
const DIR = path.join(ROOT, 'drizzle')
const FILE = '0075_kb_docs_changed.sql'
const raw = fs.readFileSync(path.join(DIR, FILE), 'utf8')
const code = (s: string) =>
  s
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')

describe(`${FILE} under the migration runner`, () => {
  const chunks = raw
    .split('--> statement-breakpoint')
    .map((c) => code(c).replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  it('has exactly two terminated statements separated by a breakpoint', () => {
    expect(raw.split('--> statement-breakpoint')).toHaveLength(2)
    expect(chunks).toHaveLength(2)
    for (const c of chunks) {
      expect(c.endsWith(';'), c).toBe(true)
      expect(c.split(';').filter(Boolean)).toHaveLength(1)
    }
  })

  it('both statements are idempotent column additions', () => {
    expect(chunks[0]).toBe('ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS docs_changed_at TEXT;')
    expect(chunks[1]).toBe('ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS docs_changed_source TEXT;')
  })

  it('contains no destructive SQL and no default or NOT NULL that would rewrite rows', () => {
    expect(code(raw)).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|DEFAULT|NOT NULL)\b/i)
  })

  it('is the only 0075 and numbering is unique and contiguous after 0074', () => {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
    expect(files.filter((f) => f.startsWith('0075_'))).toEqual([FILE])
    const nums = files.map((f) => Number(f.slice(0, 4)))
    expect(new Set(nums).size).toBe(nums.length)
    nums.forEach((n, i) => expect(n).toBe(i))
    expect(files[files.indexOf(FILE) - 1].startsWith('0074_')).toBe(true)
  })
})

describe('schema matches the 0075 SQL', () => {
  it.each([
    ['docsChangedAt', 'docs_changed_at'],
    ['docsChangedSource', 'docs_changed_source'],
  ] as const)('%s maps to %s, nullable text', (key, name) => {
    const col = getTableConfig(kbArticles).columns.find((c) => c.name === name)
    expect(col).toBeDefined()
    expect(col!.notNull).toBe(false)
    expect(col!.getSQLType()).toBe('text')
    expect(kbArticles[key].name).toBe(name)
    expect(raw).toContain(`ADD COLUMN IF NOT EXISTS ${name} TEXT`)
  })
})

describe('swapKBSource flagging', () => {
  const input = { orgId: 3, newSourceId: 200, targetFilename: 'acme/docs', published: 1 as const }
  const lower = () => calls.map((c) => c.sql.toLowerCase())
  const flagIdx = () => calls.findIndex((c) => /update\s+kb_articles\s+as\s+r/i.test(c.sql))
  const deleteIdx = () => lower().findIndex((s) => s.startsWith('delete from'))

  beforeEach(() => {
    calls.length = 0
    responses.length = 0
    failOn.match = null
  })

  // Row arrays are [id, question, answer], matching the select column order.
  const lookup = [{ id: 200 }]
  const oldRows = [
    [1, 'Q one', 'A one'],
    [2, 'Q two', 'A two'],
  ]

  it('without the flag issues no flagging update and no extra selects', async () => {
    const { swapKBSource } = await import('@/lib/db/queries/kb-sources')
    responses.push(lookup)
    await swapKBSource(input)

    expect(flagIdx()).toBe(-1)
    expect(lower().filter((s) => s.startsWith('select'))).toHaveLength(1)
    expect(calls.some((c) => c.sql.includes('docs_changed_at'))).toBe(false)
    expect(lower().filter((s) => s.startsWith('update'))).toHaveLength(2)
  })

  it('with the flag, flags before the old source is deleted', async () => {
    const { swapKBSource } = await import('@/lib/db/queries/kb-sources')
    responses.push(lookup, oldRows, [[1, 'Q one', 'A one'], [3, 'Q two', 'A two edited']])
    await swapKBSource({ ...input, flagRelatedResolutions: true })

    expect(flagIdx()).toBeGreaterThan(-1)
    expect(deleteIdx()).toBeGreaterThan(-1)
    expect(flagIdx()).toBeLessThan(deleteIdx())
    // lookup, previous, next
    expect(lower().filter((s) => s.startsWith('select'))).toHaveLength(3)
  })

  it('the flagging update is scoped to resolutions, the pinned model, and leaves updated_at alone', async () => {
    const { swapKBSource } = await import('@/lib/db/queries/kb-sources')
    responses.push(lookup, oldRows, [[1, 'Q one', 'A one'], [3, 'Q two', 'A two edited']])
    await swapKBSource({ ...input, flagRelatedResolutions: true })

    const upd = calls[flagIdx()]
    expect(upd.sql).toContain('source_ticket_id IS NOT NULL')
    expect(upd.sql).toContain('SELECT embedding_model_in_use FROM orgs')
    expect(upd.sql).toContain('c.model = r.model')
    expect(upd.sql).toContain('<=>')
    expect(upd.sql).toContain('docs_changed_at')
    expect(upd.sql.toLowerCase()).not.toContain('updated_at')
    expect(upd.params).toContain(3)
    expect(upd.params).toContain('acme/docs')
    // changed ids: old edited chunk 2 and its new wording 3 (chunk 1 unchanged)
    expect(upd.params).toEqual(expect.arrayContaining([2, 3]))
    expect(upd.params).not.toContain(1)
    expect(upd.params.some((p) => typeof p === 'number' && Math.abs(p - 0.2) < 1e-9)).toBe(true)
  })

  it('issues no flagging update on a first sync (no previous source)', async () => {
    const { swapKBSource } = await import('@/lib/db/queries/kb-sources')
    responses.push(lookup, [])
    await swapKBSource({ ...input, flagRelatedResolutions: true })

    expect(flagIdx()).toBe(-1)
    expect(lower().filter((s) => s.startsWith('select'))).toHaveLength(2) // no read of the new source
    expect(deleteIdx()).toBeGreaterThan(-1)
  })

  it('issues no flagging update when nothing changed', async () => {
    const { swapKBSource } = await import('@/lib/db/queries/kb-sources')
    responses.push(lookup, oldRows, [[10, 'Q one', 'A one'], [11, 'Q  two', 'A\ntwo']])
    await swapKBSource({ ...input, flagRelatedResolutions: true })

    expect(flagIdx()).toBe(-1)
    expect(deleteIdx()).toBeGreaterThan(-1)
  })

  it('a failing flagging step is logged and does not stop the swap', async () => {
    const { swapKBSource } = await import('@/lib/db/queries/kb-sources')
    const { logger } = await import('@/lib/logger')
    failOn.match = 'docs_changed_at'
    responses.push(lookup, oldRows, [[3, 'Q new', 'A new']])

    await expect(swapKBSource({ ...input, flagRelatedResolutions: true })).resolves.toBeUndefined()

    expect(flagIdx()).toBeGreaterThan(-1)
    expect(deleteIdx()).toBeGreaterThan(flagIdx())
    // the rename and publish updates still ran after the failed flag attempt
    expect(lower().filter((s) => s.startsWith('update'))).toHaveLength(2)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('the flagging step is wrapped in a savepoint and a try/catch (source check)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/db/queries/kb-sources.ts'), 'utf8')
    const body = src.slice(src.indexOf('async function flagResolutionsNearChangedDocs'))
    expect(body).toContain('try {')
    expect(body).toContain('tx.transaction(')
    expect(body.indexOf('try {')).toBeLessThan(body.indexOf('tx.transaction('))
    expect(body).toContain('catch (err)')
  })
})
