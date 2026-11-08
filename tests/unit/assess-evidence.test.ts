import { describe, it, expect } from 'vitest'
import { createEvidenceCollector } from '@/lib/ai/assess-evidence'

/**
 * A draft written with GitHub code search is grounded in what the tools
 * returned, not only in the knowledge base. The collector keeps those tool
 * outputs so the grader can check the draft against them too.
 */

describe('createEvidenceCollector', () => {
  it('records file contents under the file path', () => {
    const c = createEvidenceCollector()
    c.recordFile('acme/app', 'src/auth.ts', 'export const x = 1')

    expect(c.entries()).toEqual([{ question: 'File acme/app:src/auth.ts', answer: 'export const x = 1' }])
  })

  it('records search hits as path plus fragment', () => {
    const c = createEvidenceCollector()
    c.recordSearch('acme/app', 'login', [
      { path: 'src/login.ts', url: 'u', sha: 's', fragment: 'function login() {}' },
      { path: 'src/empty.ts', url: 'u', sha: 's', fragment: '' },
    ])

    expect(c.entries()).toEqual([{ question: 'Search "login" in acme/app', answer: 'src/login.ts: function login() {}\nsrc/empty.ts' }])
  })

  it('ignores tool errors, so a failed lookup is never offered as evidence', () => {
    const c = createEvidenceCollector()
    c.recordFile('acme/app', 'missing.ts', { error: 'Not Found' })
    c.recordSearch('acme/app', 'x', { error: 'rate limited' })

    expect(c.entries()).toEqual([])
  })

  it('caps one file so a huge read cannot crowd out the rest', () => {
    const c = createEvidenceCollector({ perEntryChars: 100 })
    c.recordFile('acme/app', 'big.ts', 'y'.repeat(500))

    const [entry] = c.entries()
    expect(entry.answer.length).toBeLessThanOrEqual(130)
    expect(entry.answer).toContain('(truncated)')
  })

  it('keeps entries in the order the tools ran', () => {
    const c = createEvidenceCollector()
    c.recordFile('r', 'a.ts', 'A')
    c.recordFile('r', 'b.ts', 'B')

    expect(c.entries().map((e) => e.answer)).toEqual(['A', 'B'])
  })
})
