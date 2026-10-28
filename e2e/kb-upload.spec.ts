import fs from 'fs'
import { randomUUID } from 'crypto'
import path from 'path'
import { test, expect } from '@playwright/test'
import { listKBSources, uploadFile, waitFor, FIXTURES_DIR } from './helpers'

// File upload: POST /api/kb/upload with each supported type, verify kb_sources
// row is created with correct metadata and chunk_count > 0, then delete it.

interface UploadResult {
  created: number
  duplicates?: number
  sourceId: number
  filename: string
}

// An upload whose every section is already in the knowledge base is refused, and
// state persists across the whole suite run, so a test that needs a fresh upload
// adds one section nothing else has.
function withUniqueSection(buffer: Buffer): Buffer {
  return Buffer.concat([buffer, Buffer.from(`\n\n## Unique section ${randomUUID()}\n\nThis section exists only for one test run and says something no other upload does, so it is never a duplicate.\n`)])
}

const fixtures: Array<{ file: string; mime: string }> = [
  { file: 'sample.md', mime: 'text/markdown' },
  { file: 'sample.txt', mime: 'text/plain' },
  { file: 'sample.csv', mime: 'text/csv' },
  { file: 'sample.pdf', mime: 'application/pdf' },
  { file: 'sample.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
]

test.describe('KB file upload', () => {
  for (const { file, mime } of fixtures) {
    test(`uploads ${file} and creates kb_source row`, async ({ request }) => {
      const buffer = fs.readFileSync(path.join(FIXTURES_DIR, file))
      const result = await uploadFile(request, file, mime, buffer) as UploadResult

      expect(result.sourceId).toBeGreaterThan(0)
      expect(result.filename).toBe(file)
      expect(result.created).toBeGreaterThanOrEqual(1)

      // Source appears in list with correct metadata
      const sources = await waitFor(async () => {
        const list = await listKBSources(request)
        const s = list.find((s) => s.id === result.sourceId)
        return s && s.chunk_count > 0 ? s : false
      })
      expect(sources.filename).toBe(file)
      expect(sources.chunk_count).toBeGreaterThanOrEqual(1)
      expect(sources.size_bytes).toBeGreaterThan(0)
    })
  }

  test('rejects unsupported file type', async ({ request }) => {
    const res = await request.post('/api/kb/upload', {
      multipart: {
        file: { name: 'malware.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') },
      },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toMatch(/unsupported/i)
  })

  test('rejects unauthenticated upload', async () => {
    // Override auth by using a raw fetch without the session cookie
    const res = await fetch('http://localhost:3100/api/kb/upload', {
      method: 'POST',
      headers: {},
    })
    expect(res.status).toBe(401)
  })

  test('deletes a source and its articles', async ({ request }) => {
    const buffer = withUniqueSection(fs.readFileSync(path.join(FIXTURES_DIR, 'sample.md')))
    const { sourceId } = await uploadFile(request, 'sample.md', 'text/markdown', buffer) as UploadResult

    // Wait for chunks to be embedded
    await waitFor(async () => {
      const list = await listKBSources(request)
      const s = list.find((s) => s.id === sourceId)
      return s && s.chunk_count > 0
    })

    const del = await request.delete(`/api/kb/sources/${sourceId}`)
    expect(del.status()).toBe(204)

    // Source no longer listed
    const list = await listKBSources(request)
    expect(list.find((s) => s.id === sourceId)).toBeUndefined()
  })

  test('KB page shows uploaded sources', async ({ request, page }) => {
    // sample.md was uploaded by the first test in this file; only upload it
    // again (with a section that makes it new) when this test runs on its own.
    if (!(await listKBSources(request)).some((src) => src.filename === 'sample.md')) {
      const buffer = withUniqueSection(fs.readFileSync(path.join(FIXTURES_DIR, 'sample.md')))
      await uploadFile(request, 'sample.md', 'text/markdown', buffer)
    }

    await page.goto('/kb')
    // .first(): sample.md was already uploaded by an earlier test in this
    // file (state persists for the whole suite run, no per-test isolation),
    // so more than one row with this filename is expected here.
    await expect(page.getByText('sample.md').first()).toBeVisible()
  })

  // Two uploads: the endpoint allows 10 per 10 minutes, and the rest of this
  // file already uses most of that. The raw sample.md was uploaded by the first
  // test, so its sections are already in the knowledge base.
  test('skips sections already in the knowledge base: refuses a repeat, adds only what is new', async ({ request }) => {
    const raw = fs.readFileSync(path.join(FIXTURES_DIR, 'sample.md'))

    // The same file again: every section is already there, so nothing is added
    // and no empty source is left behind.
    const sourcesBefore = await listKBSources(request)
    const repeat = await request.post('/api/kb/upload', {
      multipart: { file: { name: 'dup-copy.md', mimeType: 'text/markdown', buffer: raw } },
    })
    expect(repeat.status()).toBe(409)
    const body = (await repeat.json()) as { error: string; duplicates: number }
    expect(body.error).toMatch(/already in your knowledge base/)
    expect(body.duplicates).toBeGreaterThanOrEqual(1)
    const sourcesAfter = await listKBSources(request)
    expect(sourcesAfter).toHaveLength(sourcesBefore.length)
    expect(sourcesAfter.find((s) => s.filename === 'dup-copy.md')).toBeUndefined()

    // The same file plus one new section: only the new section is added.
    const result = (await uploadFile(request, 'dup-extended.md', 'text/markdown', withUniqueSection(raw))) as UploadResult
    expect(result.created).toBe(1)
    expect(result.duplicates).toBeGreaterThanOrEqual(1)
  })
})
