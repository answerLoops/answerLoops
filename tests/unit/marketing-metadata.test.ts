import { describe, expect, it } from 'vitest'
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
