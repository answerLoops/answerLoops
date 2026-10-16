import { eq, ne, and, desc, sql, inArray } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { kbSources, kbArticles } from '../schema'
import type { KBSource } from '@/types'

function toSource(row: typeof kbSources.$inferSelect): KBSource {
  return {
    id: row.id,
    org_id: row.orgId,
    filename: row.filename,
    file_type: row.fileType,
    size_bytes: row.sizeBytes,
    chunk_count: row.chunkCount,
    published: row.published as 0 | 1,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

export async function createKBSource(input: {
  orgId: number
  filename: string
  fileType: string
  sizeBytes: number
  // Omitted by every importer except Notion — the column default (1) then
  // applies, so existing behaviour is unchanged.
  published?: 0 | 1
}): Promise<KBSource> {
  const [row] = await getDb()
    .insert(kbSources)
    .values({
      orgId: input.orgId,
      filename: input.filename,
      fileType: input.fileType,
      sizeBytes: input.sizeBytes,
      chunkCount: 0,
      ...(input.published !== undefined && { published: input.published }),
    })
    .returning()
  return toSource(row)
}

/**
 * Flip a source's published state and every one of its chunks in lockstep.
 * `kb_articles.published` is what retrieval filters on; `kb_sources.published`
 * is what the UI shows and toggles. Both writes are org-scoped.
 */
export async function setKBSourcePublished(
  sourceId: number,
  orgId: number,
  published: 0 | 1
): Promise<void> {
  const db = getDb()
  const ts = new Date().toISOString()
  await db
    .update(kbSources)
    .set({ published, updatedAt: ts })
    .where(and(eq(kbSources.id, sourceId), eq(kbSources.orgId, orgId)))
  await db
    .update(kbArticles)
    .set({ published, updatedAt: ts })
    .where(and(eq(kbArticles.sourceId, sourceId), eq(kbArticles.orgId, orgId)))
}

export async function updateKBSourceChunkCount(id: number, chunkCount: number): Promise<void> {
  await getDb()
    .update(kbSources)
    .set({ chunkCount, updatedAt: new Date().toISOString() })
    .where(eq(kbSources.id, id))
}

export async function getKBSourceByFilename(orgId: number, filename: string): Promise<KBSource | null> {
  const [row] = await getDb()
    .select()
    .from(kbSources)
    .where(and(eq(kbSources.orgId, orgId), eq(kbSources.filename, filename)))
    .limit(1)
  return row ? toSource(row) : null
}

/**
 * Which of `filenames` already exist as sources for this org, as a Set for
 * O(1) membership checks.
 *
 * Batched deliberately: site imports now discover far more URLs than they
 * scrape in one run, so the dedup pass grew from ~25 candidates to several
 * hundred. Calling getKBSourceByFilename in a loop over that list would mean
 * one round trip per discovered page — slowest on exactly the large sites
 * this discovery limit exists to serve.
 *
 * Returns an empty Set for an empty input rather than issuing a query with an
 * empty IN list, which Postgres accepts but which is pure waste.
 */
export async function getExistingSourceFilenames(
  orgId: number,
  filenames: string[]
): Promise<Set<string>> {
  if (filenames.length === 0) return new Set()

  const rows = await getDb()
    .select({ filename: kbSources.filename })
    .from(kbSources)
    .where(and(eq(kbSources.orgId, orgId), inArray(kbSources.filename, filenames)))

  return new Set(rows.map((r) => r.filename))
}

export async function getOrCreateKBSource(input: {
  orgId: number
  filename: string
  fileType: string
}): Promise<KBSource> {
  const existing = await getKBSourceByFilename(input.orgId, input.filename)
  if (existing) return existing
  return createKBSource({ ...input, sizeBytes: 0 })
}

export async function listKBSources(orgId: number): Promise<KBSource[]> {
  const rows = await getDb()
    .select()
    .from(kbSources)
    .where(eq(kbSources.orgId, orgId))
    .orderBy(desc(kbSources.createdAt))
  return rows.map(toSource)
}

export async function deleteKBSource(id: number, orgId: number): Promise<void> {
  // Articles with source_id FK ON DELETE CASCADE are removed automatically
  await getDb()
    .delete(kbSources)
    .where(and(eq(kbSources.id, id), eq(kbSources.orgId, orgId)))
}

export async function deleteKBSourcesByFilename(orgId: number, filename: string): Promise<void> {
  await getDb()
    .delete(kbSources)
    .where(and(eq(kbSources.orgId, orgId), eq(kbSources.filename, filename)))
}

/**
 * Atomically retire an old source and promote a freshly-built one into its
 * place. Used by delete-and-recreate importers (Notion) that build the
 * replacement under a temporary filename first, so a mid-build failure leaves
 * the live source untouched instead of wiping it. Both writes share one
 * transaction: retrieval never sees a window with zero rows for `targetFilename`.
 */
export async function swapKBSource(input: {
  orgId: number
  newSourceId: number
  targetFilename: string
  published: 0 | 1
}): Promise<void> {
  const ts = new Date().toISOString()
  await getDb().transaction(async (tx) => {
    // Confirm the replacement still exists (and lock it) before retiring the
    // live source, so a missing replacement can never leave the target empty.
    const replacement = await tx
      .select({ id: kbSources.id })
      .from(kbSources)
      .where(and(eq(kbSources.id, input.newSourceId), eq(kbSources.orgId, input.orgId)))
      .for('update')
    if (replacement.length === 0) {
      throw new Error('Replacement source no longer exists; the existing source was left in place.')
    }
    await tx
      .delete(kbSources)
      .where(
        and(
          eq(kbSources.orgId, input.orgId),
          eq(kbSources.filename, input.targetFilename),
          ne(kbSources.id, input.newSourceId)
        )
      )
    await tx
      .update(kbSources)
      .set({ filename: input.targetFilename, published: input.published, updatedAt: ts })
      .where(and(eq(kbSources.id, input.newSourceId), eq(kbSources.orgId, input.orgId)))
    await tx
      .update(kbArticles)
      .set({ published: input.published, updatedAt: ts })
      .where(and(eq(kbArticles.sourceId, input.newSourceId), eq(kbArticles.orgId, input.orgId)))
  })
}
