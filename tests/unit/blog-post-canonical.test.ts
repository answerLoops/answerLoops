import { describe, it, expect } from 'vitest'
import { publicPageMetadata } from '@/lib/marketing/metadata'

// A blog post syndicated from (or to) another site, or a near-duplicate of
// one of our own posts, needs its <link rel="canonical"> pointed at the
// authoritative copy — otherwise Google can treat the two as duplicate
// content and suppress one from search entirely.
describe('publicPageMetadata canonical override', () => {
  it('defaults to self-canonical when no override is given', () => {
    const metadata = publicPageMetadata({
      title: 'A post',
      description: 'desc',
      path: '/blog/a-post',
    })
    expect(metadata.alternates?.canonical).toBe('/blog/a-post')
  })

  it('uses canonicalUrl when the post declares one', () => {
    const metadata = publicPageMetadata({
      title: 'A post',
      description: 'desc',
      path: '/blog/a-post',
      canonicalUrl: 'https://original-source.example/the-real-article',
    })
    expect(metadata.alternates?.canonical).toBe(
      'https://original-source.example/the-real-article'
    )
  })
})
