import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Boot-time seeding: runs on every deployment's startup, so it must be inert
// when the widget is off and idempotent when on.

const { runMigrations, seedProductFeedbackIfEmpty, order } = vi.hoisted(() => {
  const calls: string[] = []
  return {
    order: calls,
    runMigrations: vi.fn(async () => {
      calls.push('migrate')
    }),
    seedProductFeedbackIfEmpty: vi.fn(async () => {
      calls.push('seed')
    }),
  }
})
vi.mock('@/lib/db/migrate', () => ({ runMigrations }))
vi.mock('@/lib/db/queries/product-feedback', () => ({ seedProductFeedbackIfEmpty }))
vi.mock('../../sentry.server.config', () => ({}))

import { register } from '../../instrumentation'

describe('instrumentation register() — feedback seeding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    order.length = 0
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not seed when the widget is disabled, and boot still completes', async () => {
    vi.stubEnv('FEEDBACK_WIDGET_ENABLED', '')
    await expect(register()).resolves.toBeUndefined()
    expect(runMigrations).toHaveBeenCalledTimes(1)
    expect(seedProductFeedbackIfEmpty).not.toHaveBeenCalled()
  })

  it('seeds after migrations have run when enabled', async () => {
    vi.stubEnv('FEEDBACK_WIDGET_ENABLED', 'true')
    await register()
    expect(order).toEqual(['migrate', 'seed'])
  })

  it('does not seed on the edge runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge')
    vi.stubEnv('FEEDBACK_WIDGET_ENABLED', 'true')
    vi.doMock('../../sentry.edge.config', () => ({}))
    await register()
    expect(seedProductFeedbackIfEmpty).not.toHaveBeenCalled()
    expect(runMigrations).not.toHaveBeenCalled()
  })
})
