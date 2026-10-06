import { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { detectFileType, parseFile } from '@/lib/ingest/file-parsers'
import { chunkMarkdown } from '@/lib/ingest/url'
import { embedText, EMBEDDING_MODEL } from '@/lib/ai/embed'
import { countArticles, createArticleFromSource } from '@/lib/db/queries/kb'
import { createKBSource, updateKBSourceChunkCount } from '@/lib/db/queries/kb-sources'
import { rateLimit } from '@/lib/ratelimit'
import { logger } from '@/lib/logger'

const MOD = 'api/kb/upload'
const MAX_FILE_BYTES = 50 * 1024 * 1024 // 50 MB
const MAX_ARTICLES_PER_ORG = 2000
const MAX_CHUNKS_PER_FILE = 200

export async function POST(req: NextRequest) {
  const access = await requireOrgAccess()
  if (!access.ok) return Response.json({ error: access.error }, { status: 401 })
  const orgId = access.orgId

  const limit = rateLimit(`kb-upload:${orgId}`, 10, 10 * 60_000)
  if (!limit.ok) {
    const mins = Math.ceil(limit.retryAfterMs / 60_000)
    return Response.json({ error: `Rate limit reached. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` }, { status: 429 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'No file provided' }, { status: 400 })
  }

  if (file.size > MAX_FILE_BYTES) {
    return Response.json({ error: `File too large. Max size is 50 MB.` }, { status: 400 })
  }

  const fileType = detectFileType(file.name)
  if (!fileType) {
    return Response.json({ error: 'Unsupported file type. Supported: PDF, DOCX, MD, TXT, CSV.' }, { status: 400 })
  }

  const existing = await countArticles(orgId)
  if (existing >= MAX_ARTICLES_PER_ORG) {
    return Response.json({ error: `Knowledge base is full (${MAX_ARTICLES_PER_ORG} articles). Delete some before uploading more.` }, { status: 400 })
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

  for (const chunk of chunks.slice(0, budget)) {
    try {
      const embedding = await embedText(`${chunk.question}\n\n${chunk.answer}`)
      await createArticleFromSource({
        question: chunk.question,
        answer: chunk.answer,
        embedding,
        model: EMBEDDING_MODEL,
        sourceId: source.id,
      }, orgId)
      created++
    } catch (err) {
      logger.warn('chunk embed failed', { module: MOD, sourceId: source.id, error: err })
    }
  }

  await updateKBSourceChunkCount(source.id, created)

  logger.info('file ingested', { module: MOD, filename: file.name, created, sourceId: source.id })

  return Response.json({ created, sourceId: source.id, filename: file.name })
}
