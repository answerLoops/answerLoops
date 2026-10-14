import { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { detectFileType, parseFile } from '@/lib/ingest/file-parsers'
import { chunkMarkdown } from '@/lib/ingest/url'
import { embedTextWithModel, assertEmbeddingAvailable } from '@/lib/ai/embed'
import { aiUnavailableMessage } from '@/lib/ai/errors'
import { NoAIProviderConfiguredError } from '@/lib/ai/models'
import { countArticles, createArticleFromSource } from '@/lib/db/queries/kb'
import { createKBSource, updateKBSourceChunkCount } from '@/lib/db/queries/kb-sources'
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
  const access = await requireOrgAccess()
  if (!access.ok) return Response.json({ error: access.error }, { status: 401 })
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

  const fileType = detectFileType(file.name)
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
    logger.error('file parse failed', { module: MOD, filename: file.name, error: err })
    return Response.json({ error: 'Failed to parse file. Check the file is not corrupted.' }, { status: 400 })
  }

  if (!text.trim()) {
    return Response.json({ error: 'File appears to be empty or contains no extractable text.' }, { status: 400 })
  }

  const chunks = chunkMarkdown(text, file.name.replace(/\.[^.]+$/, '')).slice(0, MAX_CHUNKS_PER_FILE)

  if (chunks.length === 0) {
    return Response.json({ error: 'No content chunks could be extracted from this file.' }, { status: 400 })
  }

  const source = await createKBSource({
    orgId,
    filename: file.name,
    fileType,
    sizeBytes: file.size,
  })

  const budget = Math.min(chunks.length, MAX_ARTICLES_PER_ORG - existing)
  let created = 0
  // Set when AI becomes unavailable mid-file (for example, included usage is
  // used up): every remaining chunk would fail the same way, so stop there.
  let stoppedBecause: string | null = null

  for (const chunk of chunks.slice(0, budget)) {
    try {
      const { embedding, model } = await embedTextWithModel(`${chunk.question}\n\n${chunk.answer}`, orgId)
      await createArticleFromSource({
        question: chunk.question,
        answer: chunk.answer,
        embedding,
        model,
        sourceId: source.id,
      }, orgId)
      created++
    } catch (err) {
      if (err instanceof NoAIProviderConfiguredError) {
        stoppedBecause = aiUnavailableMessage(err, 'No AI provider is set up for this workspace. Add one in Settings → AI Model, then upload again.')
        break
      }
      logger.warn('chunk embed failed', { module: MOD, sourceId: source.id, error: err })
    }
  }

  await updateKBSourceChunkCount(source.id, created)

  logger.info('file ingested', { module: MOD, filename: file.name, created, sourceId: source.id, stopped: !!stoppedBecause })

  if (stoppedBecause) {
    if (created === 0) return Response.json({ error: stoppedBecause }, { status: 400 })
    // Some of the file made it in: keep it and say how far the upload got.
    return Response.json({
      created,
      sourceId: source.id,
      filename: file.name,
      error: `Added ${created} of ${budget} sections from ${file.name}. ${stoppedBecause}`,
    })
  }

  return Response.json({ created, sourceId: source.id, filename: file.name })
}
