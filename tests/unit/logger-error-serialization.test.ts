import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Regression: the logger used to serialize an Error down to just
// message/name/stack, silently dropping every extra property a driver error
// attaches — Postgres errors (via postgres.js) carry the actually-useful
// diagnostic fields (code, detail, hint, severity, column, table, cause) as
// own-enumerable properties beyond the standard Error shape. Losing those
// meant every database error in production logs showed only the query text
// and never the reason it failed.

describe('logger error serialization', () => {
  let write: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'production')
    write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    write.mockRestore()
    vi.unstubAllEnvs()
  })

  function lastLoggedEntry(): Record<string, unknown> {
    const call = write.mock.calls.at(-1)
    return JSON.parse((call?.[0] as string) ?? '{}')
  }

  it('captures extra own-enumerable properties a driver error attaches, like Postgres error codes', async () => {
    const { logger } = await import('@/lib/logger')

    const pgError = new Error('Failed query: UPDATE kb_sync_jobs ...') as Error & Record<string, unknown>
    pgError.code = '42804'
    pgError.detail = 'Column "finished_at" is of type text but expression is of type timestamp with time zone.'
    pgError.severity = 'ERROR'
    pgError.column_name = 'finished_at'

    logger.error('kb sync sweep: reclaim failed', { module: 'bot', error: pgError })

    const entry = lastLoggedEntry()
    const loggedError = entry.error as Record<string, unknown>
    expect(loggedError.code).toBe('42804')
    expect(loggedError.detail).toBe('Column "finished_at" is of type text but expression is of type timestamp with time zone.')
    expect(loggedError.severity).toBe('ERROR')
    expect(loggedError.column_name).toBe('finished_at')
    // Still carries the standard fields too.
    expect(loggedError.message).toBe('Failed query: UPDATE kb_sync_jobs ...')
    expect(loggedError.name).toBe('Error')
    expect(typeof loggedError.stack).toBe('string')
  })

  it('recursively serializes an Error assigned to .cause instead of dropping it', async () => {
    const { logger } = await import('@/lib/logger')

    const rootCause = new Error('connection terminated') as Error & Record<string, unknown>
    rootCause.code = 'ECONNRESET'
    const wrapper = new Error('Failed query: ...') as Error & Record<string, unknown>
    wrapper.cause = rootCause

    logger.error('db error', { error: wrapper })

    const entry = lastLoggedEntry()
    const loggedError = entry.error as Record<string, unknown>
    const loggedCause = loggedError.cause as Record<string, unknown>
    expect(loggedCause.message).toBe('connection terminated')
    expect(loggedCause.code).toBe('ECONNRESET')
  })

  it('never serializes function-valued properties on an error', async () => {
    const { logger } = await import('@/lib/logger')

    const err = new Error('boom') as Error & Record<string, unknown>
    err.toJSON = () => ({ leaked: true })

    logger.error('x', { error: err })

    const entry = lastLoggedEntry()
    const loggedError = entry.error as Record<string, unknown>
    expect(loggedError.toJSON).toBeUndefined()
  })

  it('still handles a non-Error thrown value without crashing', async () => {
    const { logger } = await import('@/lib/logger')

    logger.error('x', { error: 'a plain string was thrown' })

    const entry = lastLoggedEntry()
    expect(entry.error).toEqual({ raw: 'a plain string was thrown' })
  })
})
