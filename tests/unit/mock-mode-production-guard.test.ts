import { describe, it, expect, vi, afterEach } from 'vitest'

// MOCK_EXTERNALS turns off request verification and swaps real services for
// fakes, so a production process refuses to run with it set.

const KEYS = ['MOCK_EXTERNALS', 'NODE_ENV', 'NEXT_PHASE', 'MOCK_EXTERNALS_E2E'] as const
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))

function setEnv(env: Partial<Record<(typeof KEYS)[number], string | undefined>>) {
  for (const k of KEYS) {
    const v = k in env ? env[k] : undefined
    if (v === undefined) delete process.env[k]
    else (process.env as Record<string, string>)[k] = v
  }
}

async function load() {
  vi.resetModules()
  return import('@/lib/mock-mode')
}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else (process.env as Record<string, string>)[k] = saved[k]!
  }
})

describe('lib/mock-mode', () => {
  it('is off by default', async () => {
    setEnv({ NODE_ENV: 'production' })
    expect((await load()).MOCK_EXTERNALS).toBe(false)
  })

  it('is on in development and test when MOCK_EXTERNALS=1', async () => {
    setEnv({ MOCK_EXTERNALS: '1', NODE_ENV: 'development' })
    expect((await load()).MOCK_EXTERNALS).toBe(true)
    setEnv({ MOCK_EXTERNALS: '1', NODE_ENV: 'test' })
    expect((await load()).MOCK_EXTERNALS).toBe(true)
  })

  it('hard-fails on first use when NODE_ENV=production and MOCK_EXTERNALS is set', async () => {
    setEnv({ MOCK_EXTERNALS: '1', NODE_ENV: 'production' })
    await expect(load()).rejects.toThrow(/MOCK_EXTERNALS must not be set when NODE_ENV=production/)
  })

  it('does not trip during the production build step', async () => {
    setEnv({ MOCK_EXTERNALS: '1', NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' })
    expect((await load()).MOCK_EXTERNALS).toBe(true)
  })

  it('allows the e2e suite, which serves a production build, to opt in explicitly', async () => {
    setEnv({ MOCK_EXTERNALS: '1', NODE_ENV: 'production', MOCK_EXTERNALS_E2E: '1' })
    expect((await load()).MOCK_EXTERNALS).toBe(true)
  })
})
