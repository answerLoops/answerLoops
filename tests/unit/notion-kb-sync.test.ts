import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { NOTION_TOKEN_RE, getNotionPageTitle } from '@/lib/notion/client'

// Notion -> KB sync pipeline (feat/notion-kb-source). Source-file structural
// assertions plus direct unit tests of the two pure helpers — vitest cannot
// exercise the real Notion REST API or a live Postgres instance here. Same
// convention as github-discussions-kb.test.ts.
//
// The load-bearing behaviours these lock in:
//  - fetch-first, swap-last: every Notion API call happens BEFORE the live
//    kb_sources row is touched, so a Notion outage / revoked token / decrypt
//    failure aborts with the existing KB intact instead of wiping it
//  - the replacement is built under a staging filename and swapped into place
//    atomically (swapKBSource), never a delete-then-recreate window
//  - the customer's publish choice is captured before the rebuild and applied
//    in the swap (Notion imports hidden, but a re-sync must not silently
//    re-hide a workspace the customer had already published)
//  - every chunk lands published: 0 until the swap
//  - the article budget is MAX_ARTICLES_PER_ORG minus every non-Notion article
//  - every DB query is org-scoped, and the stored token is decrypted, never
//    used raw

const ROOT = process.cwd()

function read(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('lib/notion/kb-sync.ts — syncNotionToKB', () => {
  const src = read('lib/notion/kb-sync.ts')

  it('exports the sync entry point and the stable source filename', () => {
    expect(src).toContain('export async function syncNotionToKB(')
    expect(src).toContain("export const NOTION_SOURCE_FILENAME = 'notion:workspace'")
  })

  it('rebuilds against the single per-workspace source row via an atomic swap', () => {
    expect(src).toContain('getKBSourceByFilename(orgId, NOTION_SOURCE_FILENAME)')
    expect(src).toContain('swapKBSource({')
    expect(src).toContain('targetFilename: NOTION_SOURCE_FILENAME')
    // No delete of the live source anywhere in the module.
    expect(src).not.toContain('deleteKBSource(existing')
  })

  it('does every Notion fetch BEFORE it creates or swaps any source row', () => {
    const searchIdx = src.indexOf('notionSearchAll(token)')
    const pageFetchIdx = src.indexOf('notionBlockChildren(token, item.id)')
    const createIdx = src.indexOf('createKBSource({')
    const swapIdx = src.indexOf('swapKBSource({')
    expect(searchIdx).toBeGreaterThan(-1)
    expect(pageFetchIdx).toBeGreaterThan(-1)
    expect(searchIdx).toBeLessThan(createIdx)
    expect(pageFetchIdx).toBeLessThan(createIdx)
    expect(createIdx).toBeLessThan(swapIdx)
  })

  it('stages the rebuild under a distinct filename and clears a stale staging row first', () => {
    expect(src).toContain("'notion:workspace:rebuilding'")
    expect(src).toContain('deleteKBSourcesByFilename(orgId, NOTION_SOURCE_STAGING_FILENAME)')
    const clearIdx = src.indexOf('deleteKBSourcesByFilename(orgId, NOTION_SOURCE_STAGING_FILENAME)')
    const createIdx = src.indexOf('createKBSource({')
    expect(clearIdx).toBeLessThan(createIdx)
  })

  it('captures the publish choice before the rebuild and applies it in the swap', () => {
    const wasIdx = src.indexOf('const wasPublished')
    const swapIdx = src.indexOf('swapKBSource({')
    expect(wasIdx).toBeGreaterThan(-1)
    expect(wasIdx).toBeLessThan(swapIdx)
    expect(src).toMatch(/published: wasPublished \? 1 : 0/)
  })

  it('bins the staging row and rethrows if the build phase blows up', () => {
    expect(src).toMatch(/catch \(err\) \{[\s\S]*deleteKBSourcesByFilename\(orgId, NOTION_SOURCE_STAGING_FILENAME\)[\s\S]*throw err/)
  })

  it('creates the staging source as file_type notion and hidden (published: 0)', () => {
    const idx = src.indexOf('createKBSource({')
    expect(idx).toBeGreaterThan(-1)
    const call = src.slice(idx, src.indexOf('})', idx))
    expect(call).toContain("fileType: 'notion'")
    expect(call).toContain('published: 0')
  })

  it('writes every article hidden (published: 0)', () => {
    const idx = src.indexOf('createArticleFromSource(')
    expect(idx).toBeGreaterThan(-1)
    const call = src.slice(idx, src.indexOf(')', src.indexOf('orgId', idx)))
    expect(call).toContain('published: 0')
    expect(call).toContain('sourceId: source.id')
  })

  it('embeds with the shared embed helper and records the model that made the vector', () => {
    expect(src).toContain("import { embedTextWithModel } from '@/lib/ai/embed'")
    expect(src).toContain('const { embedding, model } = await embedTextWithModel(')
    expect(src).not.toContain('EMBEDDING_MODEL')
  })

  it('has a MOCK_EXTERNALS branch so tests and local mock mode never hit Notion', () => {
    expect(src).toContain("import { MOCK_EXTERNALS } from '@/lib/mock-mode'")
    expect(src).toContain('if (MOCK_EXTERNALS)')
  })

  it('budgets articles as MAX_ARTICLES_PER_ORG minus every non-Notion article', () => {
    expect(src).toMatch(/MAX_ARTICLES_PER_ORG\s*=\s*2000/)
    expect(src).toContain('await countArticles(orgId)')
    expect(src).toContain('existingNotionChunks')
    expect(src).toMatch(/MAX_ARTICLES_PER_ORG - \(\(await countArticles\(orgId\)\) - existingNotionChunks\)/)
  })

  it('records the sync state on notion_connections after the rebuild', () => {
    expect(src).toContain('updateNotionKbState(orgId, {')
    expect(src).toContain('updateKBSourceChunkCount(source.id, created)')
  })

  it('decrypts the stored token and never uses conn.accessToken raw against Notion', () => {
    expect(src).toContain("import { decryptToken } from '@/lib/crypto/tokens'")
    expect(src).toContain('decryptToken(conn.accessToken)')
    expect(src).toContain('notionSearchAll(token)')
  })

  it('passes orgId to every KB / connection query it calls', () => {
    for (const call of [
      'getNotionConnectionRow(orgId)',
      'getKBSourceByFilename(orgId, NOTION_SOURCE_FILENAME)',
      'deleteKBSourcesByFilename(orgId, NOTION_SOURCE_STAGING_FILENAME)',
      'countArticles(orgId)',
      'updateNotionKbState(orgId,',
    ]) {
      expect(src, `missing org-scoped call: ${call}`).toContain(call)
    }
    expect(src).toContain('createKBSource({\n    orgId,')
  })
})

describe('lib/notion/blocks-to-markdown.ts', () => {
  const src = read('lib/notion/blocks-to-markdown.ts')

  it('guards recursion depth and total output size', () => {
    expect(src).toMatch(/MAX_DEPTH\s*=\s*5/)
    expect(src).toMatch(/MAX_OUTPUT_CHARS\s*=\s*200_000/)
    expect(src).toContain('depth < MAX_DEPTH')
    expect(src).toContain('visited.has(block.id)')
  })

  it('handles every supported block type', () => {
    for (const type of [
      'paragraph',
      'heading_1',
      'heading_2',
      'heading_3',
      'bulleted_list_item',
      'numbered_list_item',
      'to_do',
      'quote',
      'callout',
      'code',
      'divider',
      'toggle',
      'table_row',
      'child_page',
      'child_database',
    ]) {
      expect(src, `block type not handled: ${type}`).toContain(`'${type}'`)
    }
  })

  it('salvages caption text from unknown block types in the default case', () => {
    expect(src).toContain('caption')
    expect(src).toContain('default:')
  })
})

describe('lib/notion/client.ts', () => {
  const src = read('lib/notion/client.ts')

  it('pins the Notion API version header', () => {
    expect(src).toContain('Notion-Version')
    expect(src).toContain("'2022-06-28'")
  })

  it('caps pages and databases from search against separate budgets', () => {
    expect(src).toMatch(/MAX_NOTION_PAGES\s*=\s*2000/)
    expect(src).toMatch(/MAX_NOTION_DATABASES\s*=\s*500/)
    // databases are no longer starved by a large page count
    expect(src).not.toContain('MAX_NOTION_OBJECTS - pages.length')
    expect(src).toContain('pagesCapped')
    expect(src).toContain('databasesCapped')
  })

  it('validates the token with a live /users/me call', () => {
    expect(src).toContain('/users/me')
    expect(src).toContain('export async function getNotionBotUser(')
  })

  it('exports the token-shape regex', () => {
    expect(src).toContain('export const NOTION_TOKEN_RE')
  })
})

describe('NOTION_TOKEN_RE', () => {
  it('accepts current ntn_ and legacy secret_ tokens of real length', () => {
    expect(NOTION_TOKEN_RE.test('ntn_' + 'A1b2C3d4E5f6G7h8I9j0K1')).toBe(true)
    expect(NOTION_TOKEN_RE.test('secret_' + 'A1b2C3d4E5f6G7h8I9j0K1L2')).toBe(true)
  })

  it('rejects short, empty, or garbage strings', () => {
    expect(NOTION_TOKEN_RE.test('ntn_short')).toBe(false)
    expect(NOTION_TOKEN_RE.test('secret_')).toBe(false)
    expect(NOTION_TOKEN_RE.test('')).toBe(false)
    expect(NOTION_TOKEN_RE.test('not-a-token-at-all')).toBe(false)
    expect(NOTION_TOKEN_RE.test('Bearer ntn_A1b2C3d4E5f6G7h8I9j0K1')).toBe(false)
  })
})

describe('getNotionPageTitle', () => {
  it('reads a page title from the property whose type is "title"', () => {
    expect(
      getNotionPageTitle({
        object: 'page',
        id: 'p1',
        properties: { Name: { type: 'title', title: [{ plain_text: 'Getting ' }, { plain_text: 'Started' }] } },
      }),
    ).toBe('Getting Started')
  })

  it('reads a database title from the top-level title array', () => {
    expect(
      getNotionPageTitle({ object: 'database', id: 'd1', title: [{ plain_text: 'Help Center' }] }),
    ).toBe('Help Center')
  })

  it('falls back to "Untitled" when there is no title anywhere', () => {
    expect(getNotionPageTitle({ object: 'page', id: 'p2', properties: {} })).toBe('Untitled')
    expect(getNotionPageTitle({ object: 'page', id: 'p3' })).toBe('Untitled')
    expect(
      getNotionPageTitle({ object: 'page', id: 'p4', properties: { Name: { type: 'title', title: [] } } }),
    ).toBe('Untitled')
  })
})
