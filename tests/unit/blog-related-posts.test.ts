import { describe, it, expect, vi } from 'vitest'

// getRelatedPosts ranks by shared `tags` first, falling back to `category`
// when a post has no tag overlap with anything else — mock the source so the
// test is pinned to a small, known fixture instead of drifting with
// content/blog/*.mdx.
const pages = [
  {
    slugs: ['a'],
    data: { datePublished: '2026-01-01', category: 'Integrations', tags: ['chat-integration', 'oauth'], draft: false },
  },
  {
    slugs: ['b'],
    data: { datePublished: '2026-02-01', category: 'Integrations', tags: ['chat-integration', 'confidence-review'], draft: false },
  },
  {
    slugs: ['c'],
    data: { datePublished: '2026-03-01', category: 'Integrations', tags: ['knowledge-base'], draft: false },
  },
  {
    slugs: ['d'],
    data: { datePublished: '2026-04-01', category: 'Thought Leadership', tags: ['knowledge-base'], draft: false },
  },
  {
    slugs: ['e'],
    data: { datePublished: '2026-05-01', category: 'Other', tags: [], draft: false },
  },
]

vi.mock('@/lib/blog/source', () => ({
  blogSource: {
    getPages: () => pages,
    getPage: ([slug]: [string]) => pages.find((p) => p.slugs[0] === slug),
  },
}))

const { getRelatedPosts } = await import('@/lib/blog/posts')

describe('getRelatedPosts', () => {
  it('ranks posts with more shared tags above posts with fewer, excluding unrelated posts', () => {
    const related = getRelatedPosts('a')
    expect(related.map((p) => p.slugs[0])).toEqual(['b', 'c'])
  })

  it('falls back to same-category when there is no tag overlap', () => {
    const related = getRelatedPosts('c')
    expect(related.map((p) => p.slugs[0])).toContain('a')
    expect(related.map((p) => p.slugs[0])).toContain('b')
  })

  it('excludes posts with no shared tags and no shared category', () => {
    const related = getRelatedPosts('e')
    expect(related).toEqual([])
  })

  it('respects the limit argument', () => {
    const related = getRelatedPosts('a', 1)
    expect(related).toHaveLength(1)
    expect(related[0].slugs[0]).toBe('b')
  })
})
