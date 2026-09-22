import { describe, expect, it, vi } from 'vitest'

// app/blog/page imports the Fumadocs blog source to list posts; that drags
// .mdx through vite and fails to parse under vitest. This test only checks
// the page's static `metadata` export, not the post list.
vi.mock('@/lib/blog/posts', () => ({
  getBlogPosts: () => [],
}))

import { metadata as about } from '@/app/about/page'
import { metadata as blog } from '@/app/blog/page'
import { metadata as alternatives } from '@/app/alternatives/page'

describe('public route metadata', () => {
  it.each([
    ['/about', 'About answerLoops', about],
    ['/blog', 'answerLoops blog', blog],
    ['/alternatives', 'Compare answerLoops', alternatives],
  ])('%s has its own search and social identity', (path, title, metadata) => {
    expect(metadata.title).toBe(title)
    expect(metadata.description).toBeTruthy()
    expect(metadata.alternates?.canonical).toBe(path)
    expect(metadata.openGraph).toMatchObject({
      title,
      description: metadata.description,
      url: path,
    })
    expect(metadata.twitter).toMatchObject({
      title,
      description: metadata.description,
      card: 'summary_large_image',
    })
    expect(metadata.robots).toBeUndefined()
  })
})
