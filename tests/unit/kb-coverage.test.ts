import { describe, it, expect } from 'vitest'
import { buildCoverage, statusOf, COVERAGE_MAX_ARTICLES, type CoverageRow } from '@/lib/kb/coverage'

/**
 * The Knowledge coverage view promises owners an exact picture of what the chat
 * assistant can answer from. "Live" must therefore mean precisely what
 * retrieval requires — published AND embedded (searchArticles in
 * lib/db/queries/kb.ts) — and everything else must be listed with its reason,
 * never silently dropped.
 */

const row = (over: Partial<CoverageRow> & { id: number }): CoverageRow => ({
  title: `Article ${over.id}`,
  published: 1,
  searchable: true,
  sourceId: null,
  sourceTicketId: null,
  sourceName: null,
  sourceType: null,
  ...over,
})

describe('statusOf', () => {
  it('is live only when published and searchable', () => {
    expect(statusOf({ published: 1, searchable: true })).toBe('live')
  })
  it('is unpublished whenever published is not 1, whatever the embedding', () => {
    expect(statusOf({ published: 0, searchable: true })).toBe('unpublished')
    expect(statusOf({ published: 0, searchable: false })).toBe('unpublished')
  })
  it('is not_searchable when published but missing an embedding', () => {
    expect(statusOf({ published: 1, searchable: false })).toBe('not_searchable')
  })
})

describe('buildCoverage', () => {
  it('counts each status and the number of sources', () => {
    const c = buildCoverage([
      row({ id: 1, sourceId: 10, sourceName: 'guide.pdf', sourceType: 'pdf' }),
      row({ id: 2, sourceId: 10, sourceName: 'guide.pdf', sourceType: 'pdf', published: 0 }),
      row({ id: 3, sourceId: 11, sourceName: 'docs.example.com', sourceType: 'url', searchable: false }),
      row({ id: 4 }),
    ])
    expect(c.summary).toEqual({ total: 4, live: 2, unpublished: 1, notSearchable: 1, sources: 2 })
  })

  it('groups by source, then promoted tickets, then hand-written', () => {
    const c = buildCoverage([
      row({ id: 1 }),
      row({ id: 2, sourceTicketId: 7 }),
      row({ id: 3, sourceId: 10, sourceName: 'a.md', sourceType: 'md' }),
    ])
    expect(c.groups.map((g) => [g.kind, g.label])).toEqual([
      ['source', 'a.md'],
      ['tickets', 'Promoted from resolved tickets'],
      ['manual', 'Added by hand'],
    ])
  })

  it('keeps every title, in alphabetical order within a group, with its status', () => {
    const c = buildCoverage([
      row({ id: 1, title: 'Zebra setup', sourceId: 1, sourceName: 's', published: 0 }),
      row({ id: 2, title: 'Apple setup', sourceId: 1, sourceName: 's' }),
    ])
    expect(c.groups[0].items).toEqual([
      { id: 2, title: 'Apple setup', status: 'live' },
      { id: 1, title: 'Zebra setup', status: 'unpublished' },
    ])
    expect(c.groups[0]).toMatchObject({ total: 2, live: 1 })
  })

  it('orders sources with the most live articles first', () => {
    const c = buildCoverage([
      row({ id: 1, sourceId: 1, sourceName: 'small', sourceType: 'md' }),
      row({ id: 2, sourceId: 2, sourceName: 'big', sourceType: 'md' }),
      row({ id: 3, sourceId: 2, sourceName: 'big', sourceType: 'md' }),
    ])
    expect(c.groups.map((g) => g.label)).toEqual(['big', 'small'])
  })

  it('names a source whose row has gone instead of showing a blank heading', () => {
    const c = buildCoverage([row({ id: 1, sourceId: 42, sourceName: null })])
    expect(c.groups[0].label).toBe('Removed source #42')
  })

  it('caps very long titles', () => {
    const c = buildCoverage([row({ id: 1, title: 'x'.repeat(1000) })])
    expect(c.groups[0].items[0].title.length).toBe(300)
  })

  it('reports an empty knowledge base as zeros with no groups', () => {
    const c = buildCoverage([])
    expect(c.summary).toEqual({ total: 0, live: 0, unpublished: 0, notSearchable: 0, sources: 0 })
    expect(c.groups).toEqual([])
    expect(c.truncated).toBe(false)
  })

  it('passes the truncation flag through and exposes the load cap', () => {
    expect(buildCoverage([row({ id: 1 })], true).truncated).toBe(true)
    expect(COVERAGE_MAX_ARTICLES).toBeGreaterThan(0)
  })
})
