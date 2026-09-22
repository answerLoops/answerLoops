import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Infra tests for the Notion KB API routes and server actions
// (feat/notion-kb-source). Source-file assertions only — Next.js route modules
// and 'use server' action files cannot be imported in vitest (matches
// infra-channel-routes.test.ts / discourse-webhook-route.test.ts).
//
// The security-critical shapes locked in here:
//  - GET /api/notion returns connection state and NEVER the token
//  - the publish PATCH validates its input to strictly 0 | 1
//  - the connect action validates the token shape, checks it live against
//    Notion, and encrypts before persisting
//  - Notion is NOT wrapped in requireFeature — it is deliberately un-gated

const ROOT = process.cwd()

function readRoute(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `Route not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('app/api/notion/route.ts — connection state', () => {
  const src = readRoute('app/api/notion/route.ts')

  it('exports GET and is auth-gated', () => {
    expect(src).toContain('export async function GET')
    expect(src).toContain('auth()')
  })

  it('reads through the token-free projection', () => {
    expect(src).toContain('getNotionConnection')
  })

  it('never mentions the access token — the client response must not carry it', () => {
    expect(src).not.toContain('access_token')
    expect(src).not.toContain('accessToken')
    expect(src).not.toContain('getNotionConnectionRow')
  })
})

describe('app/api/notion/sync-kb/route.ts — manual sync trigger', () => {
  const src = readRoute('app/api/notion/sync-kb/route.ts')

  it('exports POST, is auth-gated, and enqueues a background job instead of syncing inline', () => {
    expect(src).toContain('export async function POST')
    expect(src).toContain('requireOrgAccess()')
    expect(src).toContain("enqueueKbSyncJob({ orgId: access.orgId, kind: 'notion' })")
    // the heavy sync must not run in the request anymore
    expect(src).not.toContain('syncNotionToKB')
  })

  it('surfaces a queue failure as a 500 rather than swallowing it', () => {
    expect(src).toContain('status: 500')
  })
})

describe('app/api/kb/sources/[id]/route.ts — publish toggle', () => {
  const src = readRoute('app/api/kb/sources/[id]/route.ts')

  it('exports a PATCH handler that is auth-gated', () => {
    expect(src).toContain('export async function PATCH')
    expect(src).toContain('auth()')
  })

  it('rejects any published value that is not exactly 0 or 1', () => {
    expect(src).toMatch(/body\?\.published !== 0 && body\?\.published !== 1/)
    expect(src).toContain('status: 400')
  })

  it('delegates to the lockstep source+articles updater', () => {
    expect(src).toContain('setKBSourcePublished(sourceId, orgId, body.published)')
  })
})

describe('lib/actions/notion.ts — connect / disconnect actions', () => {
  const src = readRoute('lib/actions/notion.ts')

  it('exports both actions', () => {
    expect(src).toContain('export async function saveNotionConnectionAction(')
    expect(src).toContain('export async function deleteNotionConnectionAction(')
  })

  it('the connect action validates the token shape, checks it live, and encrypts before saving', () => {
    expect(src).toContain('NOTION_TOKEN_RE.test(token)')
    expect(src).toContain('getNotionBotUser(token)')
    expect(src).toContain('encryptToken(token)')
    expect(src).toContain('saveNotionConnection({ orgId, accessToken: encryptToken(token)')
  })

  it('skips the live Notion check under MOCK_EXTERNALS', () => {
    expect(src).toContain('if (!MOCK_EXTERNALS)')
  })

  it('the disconnect action also drops the synced kb_source', () => {
    expect(src).toContain('deleteNotionConnection(orgId)')
    expect(src).toContain('getKBSourceByFilename(orgId, NOTION_SOURCE_FILENAME)')
    expect(src).toContain('deleteKBSource(source.id, orgId)')
  })

  it('does NOT plan-gate Notion — no requireFeature anywhere in the file', () => {
    expect(src).not.toContain('requireFeature')
  })
})
