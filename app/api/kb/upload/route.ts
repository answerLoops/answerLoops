import { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { detectFileType, parseFile, FileParseError, MAX_EXTRACTED_TEXT_BYTES, normalizeFileName } from '@/lib/ingest/file-parsers'
import { chunkMarkdown } from '@/lib/ingest/url'
import { embedTextWithModel, assertEmbeddingAvailable } from '@/lib/ai/embed'
import { aiUnavailableMessage } from '@/lib/ai/errors'
import { NoAIProviderConfiguredError } from '@/lib/ai/models'
import { countArticles } from '@/lib/db/queries/kb'
import { createArticleFromSourceWithinCap } from '@/lib/db/queries/kb-article-cap'
import { findExactDuplicate } from '@/lib/db/queries/kb-duplicates'
import { getDb } from '@/lib/db/drizzle'
import { createKBSource, deleteKBSource, updateKBSourceChunkCount } from '@/lib/db/queries/kb-sources'
import { rateLimitShared } from '@/lib/ratelimit'
import { readBodyBytesCapped } from '@/lib/http/read-body-capped'
import { logger } from '@/lib/logger'
import { MAX_ARTICLES_PER_ORG } from '@/lib/kb/limits'

const MOD = 'api/kb/upload'
const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB
// Multipart framing (boundaries, field headers) on top of the file itself.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES
const TOO_LARGE_MESSAGE = 'File too large. Max size is 10 MB.'
const MAX_CHUNKS_PER_FILE = 200

export async function POST(req: NextRequest) {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return Response.json({ error: access.error }, { status: access.error === 'Unauthorized' ? 401 : 403 })
  const orgId = access.orgId

  const limit = await rateLimitShared(`kb-upload:${orgId}`, 10, 10 * 60_000)
  if (!limit.ok) {
    const mins = Math.ceil(limit.retryAfterMs / 60_000)
    return Response.json({ error: `Rate limit reached. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` }, { status: 429 })
  }

  // Reject on the declared length first, then count the bytes that actually
  // arrive, so an oversized upload is never buffered whole.
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return Response.json({ error: TOO_LARGE_MESSAGE }, { status: 413 })
  }
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }
  const raw = await readBodyBytesCapped(req, MAX_REQUEST_BYTES)
  if (raw === null) return Response.json({ error: TOO_LARGE_MESSAGE }, { status: 413 })

  let formData: FormData
  try {
    formData = await new Response(new Uint8Array(raw), { headers: { 'content-type': contentType } }).formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'No file provided' }, { status: 400 })
  }

  if (file.size > MAX_FILE_BYTES) {
    return Response.json({ error: TOO_LARGE_MESSAGE }, { status: 413 })
  }

  const fileName = normalizeFileName(file.name)
  if (!fileName) {
    return Response.json({ error: 'The file needs a name.' }, { status: 400 })
  }

  const fileType = detectFileType(fileName)
  if (!fileType) {
    return Response.json({ error: 'Unsupported file type. Supported: PDF, DOCX, MD, TXT, CSV.' }, { status: 400 })
  }

  const existing = await countArticles(orgId)
  if (existing >= MAX_ARTICLES_PER_ORG) {
    return Response.json({ error: `Knowledge base is full (${MAX_ARTICLES_PER_ORG} articles). Delete some before uploading more.` }, { status: 400 })
  }

  // Refuse before parsing when this workspace has no usable embedding provider.
  try {
    await assertEmbeddingAvailable(orgId)
  } catch (err) {
    if (err instanceof NoAIProviderConfiguredError) {
      return Response.json(
        { error: aiUnavailableMessage(err, 'No AI provider is set up for this workspace. Add one in Settings → AI Model, then upload again.') },
        { status: 400 }
      )
    }
    throw err
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  let text: string
  try {
    text = await parseFile(buffer, fileType)
  } catch (err) {
    logger.error('file parse failed', { module: MOD, filename: fileName, error: err })
    const message = err instanceof FileParseError ? err.message : 'Failed to parse file. Check the file is not corrupted.'
    return Response.json({ error: message }, { status: 400 })
  }

  if (Buffer.byteLength(text, 'utf-8') > MAX_EXTRACTED_TEXT_BYTES) {
    return Response.json(
      { error: 'This file contains too much text to import (limit 2 MB of text). Split it into smaller files.' },
      { status: 400 },
    )
  }

  if (!text.trim()) {
    return Response.json({ error: 'File appears to be empty or contains no extractable text.' }, { status: 400 })
  }

  const chunks = chunkMarkdown(text, fileName.replace(/\.[^.]+$/, '')).slice(0, MAX_CHUNKS_PER_FILE)

  if (chunks.length === 0) {
    return Response.json({ error: 'No content chunks could be extracted from this file.' }, { status: 400 })
  }

  const source = await createKBSource({
    orgId,
    filename: fileName,
    fileType,
    sizeBytes: file.size,
  })

  const budget = Math.min(chunks.length, MAX_ARTICLES_PER_ORG - existing)
  let created = 0
  // Sections whose exact text is already in the knowledge base, left out.
  let duplicates = 0
  // Set when AI becomes unavailable mid-file (for example, included usage is
  // used up): every remaining chunk would fail the same way, so stop there.
  let stoppedBecause: string | null = null

  for (const chunk of chunks.slice(0, budget)) {
    try {
      // Checked before embedding so a section already in the knowledge base
      // costs nothing; the insert checks again under the workspace lock.
      if ((await findExactDuplicate(getDb(), orgId, chunk.question, chunk.answer)) !== null) {
        duplicates++
        continue
      }
      const { embedding, model } = await embedTextWithModel(`${chunk.question}\n\n${chunk.answer}`, orgId)
      const row = await createArticleFromSourceWithinCap({
        question: chunk.question,
        answer: chunk.answer,
        embedding,
        model,
        sourceId: source.id,
      }, orgId, MAX_ARTICLES_PER_ORG)
      if (!row) {
        stoppedBecause = `Knowledge base is full (${MAX_ARTICLES_PER_ORG} articles). Delete some before uploading more.`
        break
      }
      if ('duplicateOf' in row) {
        duplicates++
        continue
      }
      created++
    } catch (err) {
      if (err instanceof NoAIProviderConfiguredError) {
        stoppedBecause = aiUnavailableMessage(err, 'No AI provider is set up for this workspace. Add one in Settings → AI Model, then upload again.')
        break
      }
      logger.warn('chunk embed failed', { module: MOD, sourceId: source.id, error: err })
    }
  }

  if (created === 0) {
    // Nothing landed: remove the empty source so uploading the file again is
    // not blocked by a leftover record.
    await deleteKBSource(source.id, orgId).catch((err) =>
      logger.warn('could not remove empty upload source', { module: MOD, sourceId: source.id, error: err }),
    )
    if (!stoppedBecause && duplicates > 0) {
      return Response.json(
        { error: `Everything in ${fileName} is already in your knowledge base, so nothing was added.`, duplicates },
        { status: 409 },
      )
    }
    return Response.json(
      { error: stoppedBecause ?? 'None of the content in this file could be added. Try again in a moment.' },
      { status: stoppedBecause ? 400 : 502 },
    )
  }

  await updateKBSourceChunkCount(source.id, created)

  logger.info('file ingested', { module: MOD, filename: fileName, created, duplicates, sourceId: source.id, stopped: !!stoppedBecause })

  if (stoppedBecause) {
    // Some of the file made it in: keep it and say how far the upload got.
    return Response.json({
      created,
      sourceId: source.id,
      filename: fileName,
      duplicates,
      error: `Added ${created} of ${budget} sections from ${fileName}. ${stoppedBecause}`,
    })
  }

  return Response.json({ created, duplicates, sourceId: source.id, filename: fileName })
}
