import { and, asc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { kbArticles, kbSourceFiles, kbSources } from '../schema'
import { recordArticleEvent } from './kb-events'
import { flagResolutionsNearChunks, type Tx } from './kb-sources'
import { changedChunkIds } from '@/lib/kb/docs-change'
import { contentHash } from '@/lib/kb/revision'

/**
 * The repository files a docs sync has written into a source, one row per
 * file. A file's sections and its row change together in one transaction,
 * so a file is either fully replaced or left as it was.
 */

export interface SourceFileRecord {
  id: number
  path: string
  blobSha: string
  processingVersion: number
  chunkCount: number
}

export interface EmbeddedSection {
  question: string
  answer: string
  embedding: number[]
  model: string
}

/**
 * Marks saved resolutions near the sections that changed. `budget` is shared
 * across one sync so the whole sync stays within its cap, and is only spent
 * on marking that ran. Callers pass null instead of options to skip marking
 * (a first sync, or a rebuild whose swap does its own marking).
 */
export interface FlagOptions {
  label: string
  budget: { remaining: number }
}

/** Runs first inside each write transaction; throws to abandon the write (lib/db/queries/kb-sync-jobs.ts assertKbSyncJobOwned). */
export type WriteGuard = (tx: Tx) => Promise<void>

export async function listSourceFiles(sourceId: number, orgId: number): Promise<SourceFileRecord[]> {
  return getDb()
    .select({
      id: kbSourceFiles.id,
      path: kbSourceFiles.path,
      blobSha: kbSourceFiles.blobSha,
      processingVersion: kbSourceFiles.processingVersion,
      chunkCount: kbSourceFiles.chunkCount,
    })
    .from(kbSourceFiles)
    .where(and(eq(kbSourceFiles.sourceId, sourceId), eq(kbSourceFiles.orgId, orgId)))
    .orderBy(asc(kbSourceFiles.path))
}

async function flagWithin(tx: Tx, orgId: number, ids: number[], flag: FlagOptions | null): Promise<number> {
  if (!flag || ids.length === 0 || flag.budget.remaining <= 0) return 0
  const chunkIds = ids.slice(0, flag.budget.remaining)
  const ran = await flagResolutionsNearChunks(tx, { orgId, chunkIds, sourceLabel: flag.label, ts: new Date().toISOString() })
  if (!ran) return 0
  flag.budget.remaining -= chunkIds.length
  return chunkIds.length
}

/**
 * Replaces one file's sections with `sections` and records the file's blob
 * sha, title and processing version, all in one transaction. Resolutions near
 * what changed are marked while the old sections still exist. A failure
 * anywhere (one bad embedding, say) leaves the file exactly as it was.
 */
export async function replaceFileSections(input: {
  orgId: number
  sourceId: number
  path: string
  blobSha: string
  title: string
  version: number
  sections: EmbeddedSection[]
  published: 0 | 1
  flag: FlagOptions | null
  guard?: WriteGuard
}): Promise<{ fileId: number; flagged: number }> {
  return getDb().transaction(async (tx) => {
    await input.guard?.(tx)
    // The source must be this workspace's, and is held so a concurrent swap
    // can't delete it under the write.
    const owner = await tx
      .select({ id: kbSources.id })
      .from(kbSources)
      .where(and(eq(kbSources.id, input.sourceId), eq(kbSources.orgId, input.orgId)))
      .for('share')
    if (owner.length === 0) throw new Error('source not found in this workspace')

    const ts = new Date().toISOString()
    const values = {
      orgId: input.orgId,
      sourceId: input.sourceId,
      path: input.path,
      blobSha: input.blobSha,
      title: input.title,
      chunkCount: input.sections.length,
      processingVersion: input.version,
      syncedAt: ts,
    }
    const [file] = await tx
      .insert(kbSourceFiles)
      .values(values)
      .onConflictDoUpdate({
        target: [kbSourceFiles.sourceId, kbSourceFiles.path],
        set: {
          blobSha: values.blobSha,
          title: values.title,
          chunkCount: values.chunkCount,
          processingVersion: values.processingVersion,
          syncedAt: ts,
        },
        // Never take over a row that belongs to another workspace's source.
        setWhere: eq(kbSourceFiles.orgId, input.orgId),
      })
      .returning({ id: kbSourceFiles.id })
    if (!file) throw new Error('source file belongs to another workspace')

    const columns = { id: kbArticles.id, question: kbArticles.question, answer: kbArticles.answer }
    const previous = await tx
      .select(columns)
      .from(kbArticles)
      .where(and(eq(kbArticles.orgId, input.orgId), eq(kbArticles.sourceFileId, file.id)))

    const next: { id: number; question: string; answer: string }[] = []
    for (const s of input.sections) {
      const [row] = await tx
        .insert(kbArticles)
        .values({
          orgId: input.orgId,
          question: s.question,
          answer: s.answer,
          embedding: JSON.stringify(s.embedding),
          embeddingVec: s.embedding,
          model: s.model,
          sourceId: input.sourceId,
          sourceFileId: file.id,
          published: input.published,
        })
        .returning(columns)
      await recordArticleEvent(tx, {
        orgId: input.orgId,
        articleId: row.id,
        type: 'created',
        origin: 'sync',
        contentHash: contentHash(s.question, s.answer),
      })
      next.push(row)
    }

    const flagged = await flagWithin(tx, input.orgId, changedChunkIds(previous, next), input.flag)

    if (previous.length > 0) {
      await tx.delete(kbArticles).where(and(eq(kbArticles.orgId, input.orgId), inArray(kbArticles.id, previous.map((p) => p.id))))
    }
    return { fileId: file.id, flagged }
  })
}

/**
 * Removes a file's sections and its row, marking resolutions near those
 * sections first. Returns how many sections were removed; 0 when the file
 * isn't in this workspace.
 */
export async function removeSourceFile(input: { orgId: number; fileId: number; flag: FlagOptions | null; guard?: WriteGuard }): Promise<number> {
  return getDb().transaction(async (tx) => {
    await input.guard?.(tx)
    const owned = await tx
      .select({ id: kbSourceFiles.id })
      .from(kbSourceFiles)
      .where(and(eq(kbSourceFiles.id, input.fileId), eq(kbSourceFiles.orgId, input.orgId)))
      .for('update')
    if (owned.length === 0) return 0

    const sections = await tx
      .select({ id: kbArticles.id })
      .from(kbArticles)
      .where(and(eq(kbArticles.orgId, input.orgId), eq(kbArticles.sourceFileId, input.fileId)))

    await flagWithin(tx, input.orgId, sections.map((s) => s.id), input.flag)

    // Deleted explicitly rather than left to the foreign key, so the count is
    // exact and nothing depends on how the column was created.
    if (sections.length > 0) {
      await tx.delete(kbArticles).where(and(eq(kbArticles.orgId, input.orgId), eq(kbArticles.sourceFileId, input.fileId)))
    }
    await tx.delete(kbSourceFiles).where(and(eq(kbSourceFiles.id, input.fileId), eq(kbSourceFiles.orgId, input.orgId)))
    return sections.length
  })
}
