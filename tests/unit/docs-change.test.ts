import { describe, it, expect } from 'vitest'
import { changedChunkIds, relatedDocsChange, RELATED_DOCS_SIMILARITY, MAX_CHANGED_CHUNKS } from '@/lib/kb/docs-change'

const chunk = (id: number, question: string, answer: string) => ({ id, question, answer })

describe('constants', () => {
  it('keeps the similarity bar looser than a near-duplicate and the cap positive', () => {
    expect(RELATED_DOCS_SIMILARITY).toBe(0.8)
    expect(MAX_CHANGED_CHUNKS).toBe(2000)
  })
})

describe('changedChunkIds', () => {
  const a = chunk(1, 'How do I reset?', 'Click reset.')
  const b = chunk(2, 'How do I export?', 'Use export.')

  it('returns nothing when the sources are identical in content, whatever their ids', () => {
    expect(changedChunkIds([a, b], [chunk(11, a.question, a.answer), chunk(12, b.question, b.answer)])).toEqual([])
    expect(changedChunkIds([], [])).toEqual([])
  })

  it('an edited chunk returns both its old and its new id, old first', () => {
    const edited = chunk(21, a.question, 'Click reset, then confirm.')
    expect(changedChunkIds([a, b], [edited, chunk(22, b.question, b.answer)])).toEqual([1, 21])
  })

  it('an added chunk returns only the new id', () => {
    expect(changedChunkIds([a], [chunk(31, a.question, a.answer), chunk(32, 'New?', 'New.')])).toEqual([32])
  })

  it('a removed chunk returns only the old id', () => {
    expect(changedChunkIds([a, b], [chunk(41, a.question, a.answer)])).toEqual([2])
  })

  it('a first sync (no previous chunks) reports every new chunk', () => {
    expect(changedChunkIds([], [a, b])).toEqual([1, 2])
  })

  it('a whitespace-only reflow is not a change', () => {
    const reflowed = chunk(51, '  How do I\nreset?  ', 'Click\r\n   reset.\n')
    expect(changedChunkIds([a], [reflowed])).toEqual([])
  })

  it('moving text between question and answer is a change', () => {
    const before = chunk(1, 'Reset', 'password now')
    const after = chunk(61, 'Reset password', 'now')
    expect(changedChunkIds([before], [after])).toEqual([1, 61])
  })
})

describe('relatedDocsChange', () => {
  const base = {
    docsChangedAt: '2026-03-10T00:00:00.000Z',
    docsChangedSource: 'acme/docs',
    updatedAt: '2026-03-01T00:00:00.000Z',
    verifiedAt: null as string | null,
  }

  it('is null without a date or a source', () => {
    expect(relatedDocsChange({ ...base, docsChangedAt: null })).toBeNull()
    expect(relatedDocsChange({ ...base, docsChangedSource: null })).toBeNull()
    expect(relatedDocsChange({ ...base, docsChangedAt: '' })).toBeNull()
  })

  it('is null when the change is not later than the last save', () => {
    expect(relatedDocsChange({ ...base, updatedAt: '2026-03-10T00:00:00.000Z' })).toBeNull()
    expect(relatedDocsChange({ ...base, updatedAt: '2026-03-11T00:00:00.000Z' })).toBeNull()
  })

  it('is null when the change is not later than the last verification', () => {
    expect(relatedDocsChange({ ...base, verifiedAt: '2026-03-10T00:00:00.000Z' })).toBeNull()
    expect(relatedDocsChange({ ...base, verifiedAt: '2026-03-12T00:00:00.000Z' })).toBeNull()
  })

  it('shows the notice when later than both the save and the verification', () => {
    expect(relatedDocsChange(base)).toEqual({ at: base.docsChangedAt, source: 'acme/docs' })
    expect(relatedDocsChange({ ...base, verifiedAt: '2026-03-05T00:00:00.000Z' })).toEqual({
      at: base.docsChangedAt,
      source: 'acme/docs',
    })
  })

  it('does not throw on unparseable dates', () => {
    expect(relatedDocsChange({ ...base, docsChangedAt: 'not a date' })).toBeNull()
    // unparseable save/verify dates cannot suppress a valid change
    expect(relatedDocsChange({ ...base, updatedAt: 'garbage', verifiedAt: 'garbage' })).toEqual({
      at: base.docsChangedAt,
      source: 'acme/docs',
    })
  })
})
