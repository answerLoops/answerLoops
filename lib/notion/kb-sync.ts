import { chunkMarkdown } from '@/lib/ingest/url'
import { embedText, EMBEDDING_MODEL } from '@/lib/ai/embed'
import { NoAIProviderConfiguredError } from '@/lib/ai/models'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { logger } from '@/lib/logger'
import { decryptToken } from '@/lib/crypto/tokens'
import { getNotionConnectionRow, updateNotionKbState } from '@/lib/db/queries/notion'
import {
  createKBSource,
  getKBSourceByFilename,
  deleteKBSourcesByFilename,
  updateKBSourceChunkCount,
  swapKBSource,
} from '@/lib/db/queries/kb-sources'
import { createArticleFromSource, countArticles } from '@/lib/db/queries/kb'
import {
  notionSearchAll,
  notionBlockChildren,
  queryDatabaseRows,
  getNotionPageTitle,
} from '@/lib/notion/client'
import { blocksToMarkdown } from '@/lib/notion/blocks-to-markdown'
import type { KbSyncProgressOpts } from '@/lib/kb-sync/progress'

const MOD = 'notion/kb-sync'
const MAX_ARTICLES_PER_ORG = 2000

/** The stable dedup key for the single per-workspace kb_sources row. */
export const NOTION_SOURCE_FILENAME = 'notion:workspace'

/**
 * Filename the replacement source is built under before it is swapped into
 * place. A run that dies mid-build leaves one of these orphaned; the next run
 * clears any stale copy before starting.
 */
const NOTION_SOURCE_STAGING_FILENAME = 'notion:workspace:rebuilding'

export interface NotionSyncResult {
  synced: number
  truncated: boolean
  /** A budget in lib/notion/client.ts was hit and some pages weren't fetched. */
  pagesCapped: boolean
  /** Ditto for databases. */
  databasesCapped: boolean
}


/**
 * Pull every page and database the connected Notion integration can see into
 * the KB. One kb_sources row for the whole workspace, rebuilt on each manual
 * sync. Chunks land `published: 0` — Notion is the one source that imports
 * hidden until the customer publishes it — but a prior publish choice is
 * restored afterwards.
 *
 * The rebuild is fetch-first, swap-last: every Notion API call (token decrypt,
 * search, database rows, page bodies) happens before the live source is
 * touched, then the fully-built replacement is swapped in atomically. A Notion
 * outage, a revoked token, or a decrypt failure now aborts with the existing
 * KB intact instead of wiping it and leaving an empty source behind.
 */
export async function syncNotionToKB(
  orgId: number,
  opts: KbSyncProgressOpts = {},
): Promise<NotionSyncResult> {
  const conn = await getNotionConnectionRow(orgId)
  if (!conn) throw new Error('Notion is not connected')

  let pagesCapped = false
  let databasesCapped = false

  const existing = await getKBSourceByFilename(orgId, NOTION_SOURCE_FILENAME)
  const wasPublished = existing?.published === 1

  // Budget is the org-wide article cap minus everything that isn't the current
  // Notion source — those rows are about to be replaced, so they don't count.
  const existingNotionChunks = existing?.chunk_count ?? 0
  const budget = Math.max(0, MAX_ARTICLES_PER_ORG - ((await countArticles(orgId)) - existingNotionChunks))
  if (budget === 0) {
    logger.warn('kb full — skipping notion sync', { module: MOD, orgId })
    return { synced: existingNotionChunks, truncated: true, pagesCapped, databasesCapped }
  }

  // ---- Fetch phase: everything that can fail on Notion's side, up front. ----
  interface NotionDoc {
    title: string
    markdown: string
  }
  const docs: NotionDoc[] = []
  let workCount = 0

  if (MOCK_EXTERNALS) {
    docs.push({
      title: 'Mock Notion Page',
      markdown: '# Mock Notion Page\n\nThis is a mock Notion page body used in tests and local mock mode.',
    })
    workCount = 1
  } else {
    const token = decryptToken(conn.accessToken)
    if (!token) throw new Error('Notion token could not be decrypted — reconnect the workspace')

    const search = await notionSearchAll(token)
    const { pages, databases } = search
    pagesCapped = search.pagesCapped
    databasesCapped = search.databasesCapped

    // De-duped work list: standalone pages + every row of every database.
    const seen = new Set<string>()
    const work: { id: string; title: string }[] = []
    for (const page of pages) {
      if (seen.has(page.id)) continue
      seen.add(page.id)
      work.push({ id: page.id, title: getNotionPageTitle(page) })
    }
    for (const db of databases) {
      try {
        for (const row of await queryDatabaseRows(token, db.id)) {
          if (seen.has(row.id)) continue
          seen.add(row.id)
          work.push({ id: row.id, title: getNotionPageTitle(row) })
        }
      } catch (err) {
        logger.warn('notion database query failed', { module: MOD, orgId, databaseId: db.id, error: err })
      }
    }
    workCount = work.length

    for (const item of work) {
      try {
        const blocks = await notionBlockChildren(token, item.id)
        const markdown = await blocksToMarkdown(blocks, (blockId) => notionBlockChildren(token, blockId))
        if (markdown.trim()) docs.push({ title: item.title, markdown })
      } catch (err) {
        logger.warn('notion page fetch failed', { module: MOD, orgId, pageId: item.id, error: err })
      }
    }
  }

  // ---- Build phase: stage the replacement under a temp filename. ----
  // Clear any leftover staging row from a previous run that died mid-build.
  await deleteKBSourcesByFilename(orgId, NOTION_SOURCE_STAGING_FILENAME)

  const source = await createKBSource({
    orgId,
    filename: NOTION_SOURCE_STAGING_FILENAME,
    fileType: 'notion',
    sizeBytes: 0,
    published: 0,
  })

  let created = 0
  try {
    for (let d = 0; d < docs.length; d++) {
      const doc = docs[d]
      opts.onProgress?.(d, docs.length, doc.title)
      if (created >= budget) break
      for (const chunk of chunkMarkdown(doc.markdown, doc.title)) {
        if (created >= budget) break
        try {
          const embedding = await embedText(`${chunk.question}\n\n${chunk.answer}`, orgId)
          await createArticleFromSource(
            {
              question: chunk.question,
              answer: chunk.answer,
              embedding,
              model: EMBEDDING_MODEL,
              sourceId: source.id,
              published: 0,
            },
            orgId
          )
          created++
        } catch (err) {
          // A misconfigured AI provider fails every chunk identically — retrying
          // the rest just burns through the whole workspace logging the same
          // warning before finishing "successfully" with 0 chunks. Surface it
          // as a job failure instead of a swallowed per-chunk warning.
          if (err instanceof NoAIProviderConfiguredError) throw err
          logger.warn('notion chunk embed failed', { module: MOD, orgId, title: doc.title, error: err })
        }
      }
    }
    opts.onProgress?.(docs.length, docs.length)
  } catch (err) {
    // Build blew up entirely — bin the staging row, leave the live source alone.
    await deleteKBSourcesByFilename(orgId, NOTION_SOURCE_STAGING_FILENAME)
    throw err
  }

  await updateKBSourceChunkCount(source.id, created)

  // ---- Swap phase: retire the old source and promote the new one atomically. ----
  await swapKBSource({
    orgId,
    newSourceId: source.id,
    targetFilename: NOTION_SOURCE_FILENAME,
    published: wasPublished ? 1 : 0,
  })

  await updateNotionKbState(orgId, {
    kbLastSynced: new Date().toISOString(),
    kbChunkCount: created,
    kbSourceId: source.id,
  })

  logger.info('notion kb sync done', { module: MOD, orgId, created, workCount, pagesCapped, databasesCapped })
  return { synced: created, truncated: created >= budget, pagesCapped, databasesCapped }
}
