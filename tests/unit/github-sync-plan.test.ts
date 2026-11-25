import { describe, it, expect } from 'vitest'
import { planRepoSync } from '@/lib/github/sync-plan'
import type { SourceFileRecord } from '@/lib/db/queries/kb-source-files'

// What one repo sync has to do, worked out from the files it selected and
// the files it wrote last time.

const rec = (path: string, blobSha: string, processingVersion = 1, id = path.length): SourceFileRecord => ({
  id, path, blobSha, processingVersion, chunkCount: 2,
})

describe('planRepoSync', () => {
  it('sorts each file into exactly one category', () => {
    const plan = planRepoSync(
      [
        { path: 'docs/same.md', sha: 's1' },
        { path: 'docs/edited.md', sha: 'new' },
        { path: 'docs/stale.md', sha: 's3' },
        { path: 'docs/added.md', sha: 's4' },
      ],
      [rec('docs/same.md', 's1', 2), rec('docs/edited.md', 'old', 2), rec('docs/stale.md', 's3', 1), rec('docs/gone.md', 's5', 2)],
      2
    )
    expect(plan.removed.map((r) => r.path)).toEqual(['docs/gone.md'])
    expect(plan.edited).toEqual([{ path: 'docs/edited.md', sha: 'new', record: rec('docs/edited.md', 'old', 2) }])
    expect(plan.stale).toEqual([{ path: 'docs/stale.md', sha: 's3', record: rec('docs/stale.md', 's3', 1) }])
    expect(plan.added).toEqual([{ path: 'docs/added.md', sha: 's4', record: null }])
    expect(plan.unchanged).toBe(1)
  })

  it('an edited file is not also stale', () => {
    const plan = planRepoSync([{ path: 'a.md', sha: 'new' }], [rec('a.md', 'old', 1)], 2)
    expect(plan.edited).toHaveLength(1)
    expect(plan.stale).toHaveLength(0)
  })

  it('a rename is a remove plus an add', () => {
    const plan = planRepoSync([{ path: 'docs/new-name.md', sha: 's1' }], [rec('docs/old-name.md', 's1')], 1)
    expect(plan.removed.map((r) => r.path)).toEqual(['docs/old-name.md'])
    expect(plan.added.map((i) => i.path)).toEqual(['docs/new-name.md'])
  })

  it('an empty tree removes everything', () => {
    const plan = planRepoSync([], [rec('b.md', 's'), rec('a.md', 's')], 1)
    expect(plan.removed.map((r) => r.path)).toEqual(['a.md', 'b.md'])
    expect(plan.unchanged).toBe(0)
  })

  it('records at the current version with the same sha are unchanged', () => {
    const plan = planRepoSync([{ path: 'a.md', sha: 's' }, { path: 'b.md', sha: 't' }], [rec('a.md', 's', 3), rec('b.md', 't', 3)], 3)
    expect(plan).toEqual({ removed: [], edited: [], stale: [], added: [], unchanged: 2 })
  })

  it('a file processed under a newer version than this code is left alone', () => {
    expect(planRepoSync([{ path: 'a.md', sha: 's' }], [rec('a.md', 's', 5)], 3).unchanged).toBe(1)
  })

  it('sorts every list by path', () => {
    const plan = planRepoSync(
      [{ path: 'z.md', sha: '1' }, { path: 'a.md', sha: '1' }, { path: 'm.md', sha: '1' }],
      [rec('y.md', '1'), rec('b.md', '1')],
      1
    )
    expect(plan.added.map((i) => i.path)).toEqual(['a.md', 'm.md', 'z.md'])
    expect(plan.removed.map((r) => r.path)).toEqual(['b.md', 'y.md'])
  })
})
