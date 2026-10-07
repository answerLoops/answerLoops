import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { SENTRY_DATA_COLLECTION } from '@/lib/sentry-data-collection'

// Sentry 11 collects cookies, user info, database query data and full
// request/response bodies when `dataCollection` is left unset. This app
// handles customer support messages, so both runtimes must pass the
// restrictive baseline explicitly. These tests lock in (1) that baseline and
// (2) that neither init call can quietly go back to the SDK default.

const ROOT = process.cwd()

function read(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('Sentry data collection baseline', () => {
  it('does not collect user info, cookies, database queries or queue data', () => {
    expect(SENTRY_DATA_COLLECTION.userInfo).toBe(false)
    expect(SENTRY_DATA_COLLECTION.cookies).toBe(false)
    expect(SENTRY_DATA_COLLECTION.databaseQueryData).toBe(false)
    expect(SENTRY_DATA_COLLECTION.queues).toBe(false)
  })

  it('does not collect request or response bodies', () => {
    expect(SENTRY_DATA_COLLECTION.httpBodies).toEqual([])
  })

  it('does not collect AI prompts or responses', () => {
    expect(SENTRY_DATA_COLLECTION.genAI).toEqual({ inputs: false, outputs: false })
  })

  it('does not collect GraphQL documents or variables', () => {
    expect(SENTRY_DATA_COLLECTION.graphQL).toEqual({ document: false, variables: false })
  })

  it('scrubs identifying headers and query parameters instead of allowing everything', () => {
    for (const rule of [
      SENTRY_DATA_COLLECTION.httpHeaders?.request,
      SENTRY_DATA_COLLECTION.httpHeaders?.response,
      SENTRY_DATA_COLLECTION.urlQueryParams,
    ]) {
      expect(rule).toMatchObject({ deny: expect.arrayContaining(['forwarded', 'via']) })
    }
  })
})

describe('Sentry init passes the baseline in every runtime', () => {
  it.each(['sentry.server.config.ts', 'sentry.edge.config.ts'])(
    '%s sets dataCollection from the shared baseline',
    (file) => {
      const src = read(file)
      expect(src).toMatch(/from ["']\.\/lib\/sentry-data-collection["']/)
      expect(src).toMatch(/dataCollection:\s*SENTRY_DATA_COLLECTION/)
    },
  )
})
