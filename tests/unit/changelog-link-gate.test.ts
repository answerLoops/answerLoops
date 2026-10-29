import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

/**
 * The changelog link must exist on the managed deployment and vanish
 * everywhere else.
 *
 * The changelog is a marketing page, and a self-hosted install serves no
 * marketing site — so /changelog 404s there and a link to it is a dead end in
 * the middle of somebody's dashboard. The docs tree itself is deliberately not
 * gated (documentation is useful to whoever is running the thing), so this
 * helper is the one place the conditional lives, and these tests are what keep
 * it there rather than spreading back into app/docs/layout.tsx.
 */

const ORIGINAL_MODE = process.env.DEPLOYMENT_MODE

beforeEach(() => {
  vi.resetModules()
  delete process.env.DEPLOYMENT_MODE
})

afterAll(() => {
  if (ORIGINAL_MODE === undefined) delete process.env.DEPLOYMENT_MODE
  else process.env.DEPLOYMENT_MODE = ORIGINAL_MODE
})

describe('docsChangelogLink', () => {
  it('is null when DEPLOYMENT_MODE is unset, the default a clone gets', async () => {
    delete process.env.DEPLOYMENT_MODE
    const { docsChangelogLink } = await import('@/lib/marketing/changelog-link')
    expect(docsChangelogLink()).toBeNull()
  })

  it('is null on an explicitly self-hosted deployment', async () => {
    process.env.DEPLOYMENT_MODE = 'self-hosted'
    const { docsChangelogLink } = await import('@/lib/marketing/changelog-link')
    expect(docsChangelogLink()).toBeNull()
  })

  it('is the full changelog address on the managed deployment', async () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    const { docsChangelogLink } = await import('@/lib/marketing/changelog-link')
    expect(docsChangelogLink()).toEqual({
      text: 'Changelog',
      url: 'https://answerloops.com/changelog',
    })
  })

  it('points at the marketing origin, not a relative path', async () => {
    // On a split-host deployment a relative /changelog would be served by the
    // app, which has no such route.
    process.env.DEPLOYMENT_MODE = 'cloud'
    const { docsChangelogLink } = await import('@/lib/marketing/changelog-link')
    const link = docsChangelogLink()
    expect(link).not.toBeNull()
    expect(new URL(link!.url).origin).toBe('https://answerloops.com')
  })
})
