import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

/**
 * The changelog links (docs header, dashboard sidebar) must disappear on a
 * self-hosted install.
 *
 * One image serves both the managed deployment and every self-hosted install,
 * so without the gate every self-hoster renders a link to /changelog — a page
 * their deployment 404s. A dead link in a dashboard is worse than no link.
 *
 * The polarity matters more than the test itself: `getDeploymentMode()`
 * returns 'self-hosted' whenever DEPLOYMENT_MODE is unset, so the safe state
 * is the default. A refactor that inverts this reintroduces the dead link
 * everywhere at once. See tests/unit/marketing-surface-gate.test.ts for the
 * same reasoning applied to the marketing surface as a whole.
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

describe('changelog link is hidden when the marketing site is off', () => {
  it('is hidden when DEPLOYMENT_MODE is unset', async () => {
    delete process.env.DEPLOYMENT_MODE
    const { marketingSiteEnabled } = await import('@/lib/site')
    expect(marketingSiteEnabled()).toBe(false)
  })

  it('is hidden on an explicitly self-hosted deployment', async () => {
    process.env.DEPLOYMENT_MODE = 'self-hosted'
    const { marketingSiteEnabled } = await import('@/lib/site')
    expect(marketingSiteEnabled()).toBe(false)
  })

  it('is shown only on the managed deployment', async () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    const { marketingSiteEnabled } = await import('@/lib/site')
    expect(marketingSiteEnabled()).toBe(true)
  })
})
