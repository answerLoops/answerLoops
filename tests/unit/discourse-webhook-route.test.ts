import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Infra tests for the new Discourse channel API routes. Source-file
// assertions only — Next.js route modules cannot be imported in vitest
// (matches tests/unit/infra-channel-routes.test.ts). These lock in the
// security-critical shape of the inbound webhook: it resolves the org from
// the instance header, verifies the HMAC before doing anything, only acts
// on post_created, and hands off to the shared ingest pipeline. The
// register route must talk to Discourse's admin web_hooks API.

const ROOT = process.cwd()

function readRoute(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `Route not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('Discourse inbound webhook route', () => {
  const src = readRoute('app/api/discourse/webhook/route.ts')

  it('exists and exports POST', () => {
    expect(src).toContain('export async function POST')
  })

  it('resolves the org from the instance header before touching the body', () => {
    expect(src).toContain('getIntegrationByDiscourseSite')
    expect(src.toLowerCase()).toContain('x-discourse-instance')
  })

  it('verifies the HMAC signature against the per-org secret', () => {
    expect(src).toContain('verifyDiscourseSignature')
    expect(src.toLowerCase()).toContain('x-discourse-event-signature')
  })

  it('only acts on the post_created event', () => {
    expect(src).toContain('post_created')
  })

  it('hands off to the shared ingest pipeline with platform discourse', () => {
    expect(src).toContain('processCommunityMessage')
    expect(src).toContain("platform: 'discourse'")
  })
})

describe('Discourse webhook register route', () => {
  const src = readRoute('app/api/discourse/register/route.ts')

  it('exists and exports POST', () => {
    expect(src).toContain('export async function POST')
  })

  it('is auth-gated', () => {
    expect(src).toContain('requireOrgAccess()')
  })

  it('calls the Discourse admin web_hooks API via discourseFetch', () => {
    expect(src).toContain('discourseFetch')
    expect(src).toContain('/admin/api/web_hooks')
  })
})
