import { describe, expect, it } from 'vitest'
import { chunkMarkdown } from '@/lib/ingest/url'

// Every section body has to clear the 60-character minimum to become a chunk.
const body = (s: string) => `${s} ${'with enough detail to be kept as its own article.'.repeat(2)}`

describe('chunkMarkdown', () => {
  it('titles each section with the page it came from, so a vague question can still find it', () => {
    const md = `# Pricing\n\n## Pro\n\n${body('$49 a month, 2,000 answers.')}\n\n## Team\n\n${body('$149 a month, 10,000 answers.')}`
    const chunks = chunkMarkdown(md, 'Pricing')
    expect(chunks.map((c) => c.question)).toEqual(['Pricing › Pro', 'Pricing › Team'])
    expect(chunks[0].answer).toContain('$49 a month')
  })

  it('keeps the bare heading beside the title, so the same section under another page title is still recognised', () => {
    const md = `## Pro\n\n${body('$49 a month.')}`
    expect(chunkMarkdown(md, 'Pricing')[0]).toMatchObject({ question: 'Pricing › Pro', heading: 'Pro' })
    expect(chunkMarkdown(md, '')[0]).toMatchObject({ question: 'Pro', heading: 'Pro' })
  })

  it('does not repeat the page title when the heading already is the page title', () => {
    const md = `## Pricing\n\n${body('Plans start at $49 a month.')}`
    expect(chunkMarkdown(md, 'Pricing').map((c) => c.question)).toEqual(['Pricing'])
  })

  it('compares the heading and page title without regard to case or surrounding space', () => {
    const md = `## pricing \n\n${body('Plans start at $49 a month.')}`
    expect(chunkMarkdown(md, '  Pricing').map((c) => c.question)).toEqual(['pricing'])
  })

  it('uses the heading alone when there is no page title', () => {
    const md = `## Pro\n\n${body('$49 a month.')}`
    expect(chunkMarkdown(md, '').map((c) => c.question)).toEqual(['Pro'])
  })

  it('titles every part of a long section that had to be split', () => {
    const para = 'A paragraph about plan limits and what each one includes. '.repeat(10)
    const md = `## Limits\n\n${Array.from({ length: 6 }, () => para).join('\n\n')}`
    const chunks = chunkMarkdown(md, 'Pricing')
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.question).toBe('Pricing › Limits')
  })

  it('falls back to the page title alone for a page with no headings', () => {
    const md = body('Plans start at $49 a month and every plan includes the widget.')
    expect(chunkMarkdown(md, 'Pricing').map((c) => c.question)).toEqual(['Pricing'])
  })

  it('keeps the combined title within the 300-character question limit', () => {
    const md = `## ${'h'.repeat(200)}\n\n${body('Text.')}`
    const [chunk] = chunkMarkdown(md, 't'.repeat(200))
    expect(chunk.question.length).toBeLessThanOrEqual(300)
    expect(chunk.question.startsWith('t'.repeat(200) + ' › ')).toBe(true)
  })
})
