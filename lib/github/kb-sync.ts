import { getInstallationOctokit } from './app'
import type { KbSyncProgressOpts } from '@/lib/kb-sync/progress'
import { chunkMarkdown } from '@/lib/ingest/url'
import { embedTextWithModel } from '@/lib/ai/embed'
import { NoAIProviderConfiguredError } from '@/lib/ai/models'
import {
  createArticleFromSource,
  upsertArticleFromSource,
  deleteArticleBySourceAndPage,
  countArticles,
  countArticlesForSource,
} from '@/lib/db/queries/kb'
import {
  createKBSource,
  getKBSourceByFilename,
  getOrCreateKBSource,
  deleteKBSource,
  deleteKBSourcesByFilename,
  updateKBSourceChunkCount,
  swapKBSource,
} from '@/lib/db/queries/kb-sources'
import { updateRepoSettings } from '@/lib/db/queries/github'
import { KbSyncUserError, KbSyncLeaseLostError } from '@/lib/kb-sync/errors'
import { logger } from '@/lib/logger'
import { selectDocFiles, toTreeEntries, MAX_DOC_FILE_BYTES, ROOT_FOLDER, type TreeEntry } from './doc-folders'
import { cleanDocsFile } from '@/lib/ingest/docs-file'
import { MAX_ARTICLES_PER_ORG } from '@/lib/kb/limits'
import type { KBSource, RepoSyncResult } from '@/types'
import { listSourceFiles, removeSourceFile, replaceFileSections, type EmbeddedSection, type FlagOptions, type SourceFileRecord, type WriteGuard } from '@/lib/db/queries/kb-source-files'
import { planRepoSync, type SyncItem } from './sync-plan'
import { reprocessEmbedder, type Embedder } from '@/lib/kb/pass-embedder'
import { MAX_CHANGED_CHUNKS } from '@/lib/kb/docs-change'
import { DOCS_PROCESSING_VERSION } from '@/lib/ingest/docs-file'

/**
 * Failure cleanup for a staging source this worker created. After a lease loss
 * another worker may own the staging filename now, so nothing is deleted. For
 * any other error only the row this worker created (by id) is removed.
 */
async function cleanupStaging(orgId: number, sourceId: number, err: unknown): Promise<void> {
  if (err instanceof KbSyncLeaseLostError) return
  await deleteKBSource(sourceId, orgId)
}

/**
 * Confirms the staging source this worker created is still there before it is
 * swapped in; if it vanished, the live source is left untouched.
 */
async function assertStagingPresent(orgId: number, staging: string, sourceId: number): Promise<void> {
  const current = await getKBSourceByFilename(orgId, staging)
  if (!current || current.id !== sourceId) {
    throw new Error('staging source no longer exists; sync aborted before replacing the live source')
  }
}

const MOD = 'github/kb-sync'
const MAX_DISCUSSIONS = 300

/**
 * Filename a replacement source is built under before it is swapped into
 * place. A run that dies mid-build leaves one orphaned; the next run clears
 * any stale copy before it starts.
 */
function stagingFilename(filename: string): string {
  return `${filename}:rebuilding`
}

const NOTHING_IMPORTED_MESSAGE =
  'Nothing could be imported from the repository this time, so the existing knowledge base content was kept. Try again shortly.'

export { describeRepoSync } from './sync-summary'

/** One file read from the repository: cleaned and split into sections, not yet embedded. */
interface ReadFile {
  title: string
  chunks: { question: string; answer: string }[]
}

/**
 * Reads, cleans and chunks one file. Returns null when the path isn't a
 * readable file. Embedding is a separate step, so a file that won't fit is
 * never embedded.
 */
async function readFile(octokit: Octokit, owner: string, repo: string, commitSha: string, path: string): Promise<ReadFile | null> {
  const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref: commitSha })
  if (Array.isArray(data) || data.type !== 'file' || typeof data.content !== 'string') return null
  const { title, markdown } = cleanDocsFile(path, Buffer.from(data.content, 'base64').toString('utf8'))
  return { title, chunks: chunkMarkdown(markdown, title).map((c) => ({ question: c.question, answer: c.answer })) }
}

/** Embeds every section of a file. Any failure fails the whole file, so a file is only ever written complete. */
async function embedSections(chunks: ReadFile['chunks'], embed: Embedder): Promise<EmbeddedSection[]> {
  const sections: EmbeddedSection[] = []
  for (const chunk of chunks) {
    const { embedding, model } = await embed(`${chunk.question}\n\n${chunk.answer}`)
    sections.push({ question: chunk.question, answer: chunk.answer, embedding, model })
  }
  return sections
}

export interface SyncRepoOpts extends KbSyncProgressOpts {
  /**
   * A background re-processing job (lib/github/docs-reprocess.ts): only redo
   * files processed under older rules, or the one-time rebuild, on the
   * re-processing embedder; edits, new and removed files wait for the next
   * push. Nothing happens when nobody would pay for re-processing.
   */
  reprocessOnly?: boolean
  /** Runs inside every file write; throws when this worker no longer owns the job. */
  guard?: WriteGuard
}

/** Errors that stop the whole sync rather than counting one file as failed. */
function stopsSync(err: unknown): boolean {
  return err instanceof NoAIProviderConfiguredError || err instanceof KbSyncLeaseLostError
}

/**
 * Syncs the repo's docs into its files source, touching only what changed.
 *
 * Files come from the folders the owner picked (`kbPaths`), or every Markdown
 * file when none were picked. Each synced file has a record of its git blob
 * sha and the cleanup rules version it was processed under
 * (lib/db/queries/kb-source-files.ts). A sync removes files that are gone,
 * replaces edited ones, re-processes files done under older rules, and adds
 * new ones, in that order, each file in its own transaction. Unchanged files
 * are not downloaded.
 *
 * A source synced before files were recorded is rebuilt once, alongside the
 * live one and swapped in when complete, writing the records.
 *
 * There is no file cap: the knowledge base's article limit is the only bound.
 * A file that would not fit is left as it was (an edited file keeps its old
 * sections) and tried again next sync. Files that are only out of date by
 * cleanup rules are re-processed on the re-processing embedder
 * (lib/kb/pass-embedder.ts), or left as they are when there is none.
 */
export async function syncRepoToKB(
  repoId: number,
  owner: string,
  repo: string,
  installationId: number,
  orgId: number,
  kbPaths: string[] | null,
  opts: SyncRepoOpts = {}
): Promise<{ chunks: number; result: RepoSyncResult }> {
  const octokit = await getInstallationOctokit(owner, repo, orgId)

  // Resolve the head once and read everything from that commit. Without this a
  // push landing mid-sync could mix files from two versions, and there would be
  // no single commit to record as the one this knowledge reflects.
  const { data: head } = await octokit.rest.repos.getCommit({ owner, repo, ref: 'HEAD' })
  const commitSha = head.sha

  const { data: tree } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: commitSha,
    recursive: '1',
  })

  // GitHub cuts the recursive tree short on very large repositories. With
  // folders chosen, each one is then read on its own so none goes missing;
  // without them there is nothing narrower to read.
  let entries = toTreeEntries(tree.tree)
  let truncated = !!tree.truncated
  if (truncated && kbPaths) ({ entries, truncated } = await readChosenFolders(octokit, owner, repo, commitSha, kbPaths))

  const selection = selectDocFiles(entries, kbPaths)
  // A tree that is still incomplete may simply not show a folder, so it is
  // never used to say a folder is gone.
  const missingFolders = truncated ? [] : selection.missingFolders
  const tooLarge = selection.files.filter((f) => (f.size ?? 0) > MAX_DOC_FILE_BYTES).length
  // Empty files have nothing to add; neither is downloaded.
  const mdFiles = selection.files.filter((f) => f.size === undefined || (f.size > 0 && f.size <= MAX_DOC_FILE_BYTES))
  const result: RepoSyncResult = { synced: 0, skippedForRoom: 0, failed: 0, tooLarge, missingFolders }

  logger.info('github kb sync started', { module: MOD, owner, repo, fileCount: mdFiles.length, chosenFolders: kbPaths?.length ?? 0 })

  const sourceFilename = `${owner}/${repo}`
  const existing = await getKBSourceByFilename(orgId, sourceFilename)
  const existingCount = existing ? await countArticlesForSource(existing.id, orgId) : 0

  // Every chosen folder is gone (renamed or moved, usually): keep what is
  // live rather than removing everything, and say why on the repo row.
  if (kbPaths && kbPaths.length > 0 && missingFolders.length === kbPaths.length && existingCount > 0) {
    logger.warn('github kb sync — no chosen docs folder exists, keeping live docs', { module: MOD, orgId, owner, repo })
    await updateRepoSettings(repoId, orgId, { kbSyncResult: result })
    return { chunks: existingCount, result }
  }

  const ctx: SyncContext = { octokit, owner, repo, orgId, repoId, commitSha, sourceFilename, mdFiles, truncated, result, opts, guard: opts.guard }
  const records = existing ? await listSourceFiles(existing.id, orgId) : []
  // The one-time rebuild reads whatever GitHub lists, as every sync did before
  // files were recorded; on a repository too large to list in full, choosing
  // docs folders is what makes the listing complete.
  const needsRebuild = existing && existingCount > 0 && records.length === 0
  if (opts.reprocessOnly) return reprocessOnly(ctx, existing, records, existingCount, !!needsRebuild)
  const chunks = needsRebuild
    ? await rebuildWithRecords(ctx, existing, existingCount, null)
    : await syncChangedFiles(ctx, existing, records, existingCount, null)
  if (chunks === null) return { chunks: existingCount, result }

  await recordSync(ctx, chunks)

  logger.info('github kb sync done', { module: MOD, owner, repo, chunks, ...result, missingFolders: missingFolders.length })
  return { chunks, result }
}

/**
 * A background re-processing job: the one-time rebuild, or just the files
 * processed under older rules, on the re-processing embedder only. When
 * nobody would pay for that, nothing changes. A rebuild covers every file,
 * so it records the sync like any other; re-processing a few files leaves
 * the last full sync's commit and result in place.
 */
async function reprocessOnly(
  ctx: SyncContext,
  existing: KBSource | null,
  records: SourceFileRecord[],
  existingCount: number,
  needsRebuild: boolean
): Promise<{ chunks: number; result: RepoSyncResult }> {
  const embedder = existing ? await reprocessEmbedder(ctx.orgId) : null
  if (!existing || !embedder) return { chunks: existingCount, result: ctx.result }
  if (needsRebuild) {
    const chunks = await rebuildWithRecords(ctx, existing, existingCount, embedder)
    if (chunks === null) return { chunks: existingCount, result: ctx.result }
    await recordSync(ctx, chunks)
    return { chunks, result: ctx.result }
  }
  const chunks = await syncChangedFiles(ctx, existing, records, existingCount, embedder)
  await updateRepoSettings(ctx.repoId, ctx.orgId, { kbChunkCount: chunks + (await discussionChunks(ctx)) })
  return { chunks, result: ctx.result }
}

async function discussionChunks(ctx: SyncContext): Promise<number> {
  return (await getKBSourceByFilename(ctx.orgId, discussionSourceFilename(ctx.owner, ctx.repo)))?.chunk_count ?? 0
}

/** Records a complete sync on the repo row: when, which commit, how many sections, and what it did. */
async function recordSync(ctx: SyncContext, chunks: number): Promise<void> {
  await updateRepoSettings(ctx.repoId, ctx.orgId, {
    kbLastSynced: new Date().toISOString(),
    kbSyncedCommit: ctx.commitSha,
    kbChunkCount: chunks + (await discussionChunks(ctx)),
    kbSyncResult: ctx.result,
  })
}

interface SyncContext {
  octokit: Octokit
  owner: string
  repo: string
  orgId: number
  repoId: number
  commitSha: string
  sourceFilename: string
  mdFiles: TreeEntry[]
  truncated: boolean
  result: RepoSyncResult
  opts: KbSyncProgressOpts
  guard?: WriteGuard
}

const normalEmbedder = (orgId: number): Embedder => (text) => embedTextWithModel(text, orgId)

/**
 * The incremental path. Returns the source's section count after the sync.
 */
async function syncChangedFiles(
  ctx: SyncContext,
  existing: KBSource | null,
  records: SourceFileRecord[],
  existingCount: number,
  /** Set for a background re-processing job: only stale files, on this embedder. */
  reprocessWith: { embed: Embedder } | null
): Promise<number> {
  const { orgId, result } = ctx
  const source = existing ?? (await createKBSource({ orgId, filename: ctx.sourceFilename, fileType: 'github', sizeBytes: 0 }))
  const published = source.published
  // With nothing synced before (a first sync, or one that never got further
  // than creating the source) there is nothing to compare with, so no
  // resolutions are marked.
  const flag: FlagOptions | null =
    records.length > 0 || existingCount > 0 ? { label: ctx.sourceFilename, budget: { remaining: MAX_CHANGED_CHUNKS } } : null

  const plan = planRepoSync(ctx.mdFiles.map((f) => ({ path: f.path, sha: f.sha })), records, DOCS_PROCESSING_VERSION)
  // An incomplete listing can't tell a deleted file from one it didn't show.
  if (ctx.truncated) plan.removed = []
  // A background re-processing job leaves real changes to the next push.
  if (reprocessWith) {
    plan.unchanged += plan.edited.length + plan.added.length
    plan.removed = []
    plan.edited = []
    plan.added = []
  }

  const reprocess = reprocessWith ?? (plan.stale.length > 0 ? await reprocessEmbedder(orgId) : null)
  const stale = reprocess ? plan.stale : []
  const normal = normalEmbedder(orgId)
  let room = MAX_ARTICLES_PER_ORG - (await countArticles(orgId))

  const counts = { updated: 0, added: 0, removed: 0, unchanged: plan.unchanged + (reprocess ? 0 : plan.stale.length) }
  const total = plan.removed.length + plan.edited.length + stale.length + plan.added.length
  let done = 0
  let attempted = 0

  for (const record of plan.removed) {
    ctx.opts.onProgress?.(done++, total, record.path)
    room += await removeSourceFile({ orgId, fileId: record.id, flag, guard: ctx.guard })
    counts.removed++
  }

  // Re-processing under new rules changes no docs, so it marks no resolutions.
  const work: { item: SyncItem; embed: Embedder; kind: 'updated' | 'added'; marks: boolean }[] = [
    ...plan.edited.map((item) => ({ item, embed: normal, kind: 'updated' as const, marks: true })),
    ...stale.map((item) => ({ item, embed: reprocess!.embed, kind: 'updated' as const, marks: false })),
    ...plan.added.map((item) => ({ item, embed: normal, kind: 'added' as const, marks: true })),
  ]
  for (const { item, embed, kind, marks } of work) {
    ctx.opts.onProgress?.(done++, total, item.path)
    // Once the knowledge base is full, new files can't fit, so they aren't
    // downloaded. An edited file might still fit if it shrank.
    if (!item.record && room <= 0) {
      result.skippedForRoom++
      continue
    }
    attempted++
    try {
      const file = await readFile(ctx.octokit, ctx.owner, ctx.repo, ctx.commitSha, item.path)
      if (!file) {
        result.failed++
        continue
      }
      const growth = file.chunks.length - (item.record?.chunkCount ?? 0)
      if (growth > 0 && growth > room) {
        // Left exactly as it was (old sections and record), tried again next
        // sync, and not embedded: that would be spent on nothing.
        attempted--
        result.skippedForRoom++
        continue
      }
      await replaceFileSections({
        orgId,
        sourceId: source.id,
        path: item.path,
        blobSha: item.sha,
        title: file.title,
        version: DOCS_PROCESSING_VERSION,
        sections: await embedSections(file.chunks, embed),
        published,
        flag: marks ? flag : null,
        guard: ctx.guard,
      })
      room -= growth
      counts[kind]++
    } catch (err) {
      if (stopsSync(err)) throw err
      logger.warn('github kb sync — file left as it was', { module: MOD, path: item.path, error: err })
      result.failed++
    }
  }
  ctx.opts.onProgress?.(total, total)

  Object.assign(result, counts, { synced: records.length - counts.removed + counts.added })
  // Recorded before any error below: removals have already been committed.
  const chunks = await countArticlesForSource(source.id, orgId)
  await updateKBSourceChunkCount(source.id, chunks)

  // Files needed work and not one of them could be written (provider or
  // network trouble on every call): say so rather than report a quiet success.
  if (attempted > 0 && result.failed === attempted) throw new KbSyncUserError(NOTHING_IMPORTED_MESSAGE)
  return chunks
}

/**
 * The one-time rebuild of a source synced before files were recorded: built
 * alongside the live source under a staging name, with a record per file,
 * and swapped in when complete. Returns the new section count, or null when
 * the knowledge base had no room at all.
 */
async function rebuildWithRecords(
  ctx: SyncContext,
  existing: KBSource,
  existingCount: number,
  /** The re-processing embedder for a background job; otherwise picked here. */
  embedWith: { embed: Embedder } | null
): Promise<number | null> {
  const { orgId, result, mdFiles } = ctx
  const staging = stagingFilename(ctx.sourceFilename)

  // Clear any leftover staging row first so its chunks do not count against the budget.
  await deleteKBSourcesByFilename(orgId, staging)

  // The source being replaced does not count against the cap.
  const budget = Math.max(0, MAX_ARTICLES_PER_ORG - ((await countArticles(orgId)) - existingCount))
  if (budget === 0) {
    logger.warn('kb full — skipping github sync', { module: MOD, orgId })
    result.skippedForRoom = mdFiles.length
    await updateRepoSettings(ctx.repoId, orgId, { kbSyncResult: result })
    return null
  }

  // Re-processing the existing docs runs on the re-processing embedder when
  // there is one. Without one (no live subscription, or a model switch in
  // progress) a push-triggered rebuild uses the workspace's normal embedder,
  // as every push did before files were recorded.
  const embed = (embedWith ?? (await reprocessEmbedder(orgId)))?.embed ?? normalEmbedder(orgId)
  const source = await createKBSource({ orgId, filename: staging, fileType: 'github', sizeBytes: 0, published: 0 })

  let created = 0
  try {
    for (let fi = 0; fi < mdFiles.length; fi++) {
      const file = mdFiles[fi]
      ctx.opts.onProgress?.(fi, mdFiles.length, file.path)
      if (created >= budget) {
        result.skippedForRoom += mdFiles.length - fi
        break
      }
      try {
        const read = await readFile(ctx.octokit, ctx.owner, ctx.repo, ctx.commitSha, file.path)
        if (!read) {
          result.failed++
          continue
        }
        if (read.chunks.length > budget - created) {
          result.skippedForRoom++
          continue
        }
        await replaceFileSections({
          orgId,
          sourceId: source.id,
          path: file.path,
          blobSha: file.sha,
          title: read.title,
          version: DOCS_PROCESSING_VERSION,
          sections: await embedSections(read.chunks, embed),
          published: 0,
          // The swap below marks resolutions near what changed.
          flag: null,
          guard: ctx.guard,
        })
        created += read.chunks.length
        if (read.chunks.length > 0) result.synced++
      } catch (err) {
        if (stopsSync(err)) throw err
        logger.warn('github kb sync — file skipped in rebuild', { module: MOD, path: file.path, error: err })
        result.failed++
      }
    }
    ctx.opts.onProgress?.(mdFiles.length, mdFiles.length)

    // Files were found but not one section made it in (provider or network
    // trouble on every call): keep what is live rather than swapping in nothing.
    // A folder of pages too short to become sections is a real result, not a
    // failure to retry, so it only counts when files actually failed.
    if (created === 0 && mdFiles.length > 0 && result.failed > 0) {
      throw new KbSyncUserError(NOTHING_IMPORTED_MESSAGE)
    }
  } catch (err) {
    // Build failed — bin the staging row and leave the live source alone.
    await cleanupStaging(orgId, source.id, err)
    throw err
  }

  // Nothing fitted in the room left (every file is bigger than it): keep what
  // is live rather than swapping in nothing, and say why on the repo row.
  if (created === 0 && result.skippedForRoom > 0) {
    await deleteKBSource(source.id, orgId)
    await updateRepoSettings(ctx.repoId, orgId, { kbSyncResult: result })
    return null
  }

  await assertStagingPresent(orgId, staging, source.id)
  await updateKBSourceChunkCount(source.id, created)
  await swapKBSource({
    orgId,
    newSourceId: source.id,
    targetFilename: ctx.sourceFilename,
    published: existing.published,
    flagRelatedResolutions: true,
  })
  return created
}

type Octokit = Awaited<ReturnType<typeof getInstallationOctokit>>

/**
 * The chosen folders' files, read folder by folder: walk down to each folder
 * with one-level listings, then read that folder recursively. Used when the
 * whole repository's tree was too large for GitHub to return in full. A
 * folder that isn't found is left out, so it is reported as gone.
 */
async function readChosenFolders(
  octokit: Octokit,
  owner: string,
  repo: string,
  commitSha: string,
  kbPaths: string[]
): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const listings = new Map<string, TreeEntry[]>()
  const list = async (sha: string) => {
    if (!listings.has(sha)) {
      const { data } = await octokit.rest.git.getTree({ owner, repo, tree_sha: sha })
      listings.set(sha, toTreeEntries(data.tree))
    }
    return listings.get(sha)!
  }

  const entries: TreeEntry[] = []
  let truncated = false
  for (const folder of kbPaths) {
    if (folder === ROOT_FOLDER) {
      entries.push(...(await list(commitSha)).filter((e) => e.type === 'blob'))
      continue
    }
    let sha: string | null = commitSha
    for (const segment of folder.split('/')) {
      const found: TreeEntry | undefined = (await list(sha!)).find((e) => e.type === 'tree' && e.path === segment)
      sha = found ? found.sha : null
      if (!sha) break
    }
    if (!sha) continue
    const { data } = await octokit.rest.git.getTree({ owner, repo, tree_sha: sha, recursive: '1' })
    if (data.truncated) truncated = true
    entries.push({ path: folder, type: 'tree', sha })
    for (const e of toTreeEntries(data.tree)) entries.push({ ...e, path: `${folder}/${e.path}` })
  }
  return { entries, truncated }
}

// ── GitHub Discussions → KB ────────────────────────────────────────────────
// GitHub Discussion answers aren't exposed over REST; @octokit/rest has no
// GraphQL plugin bundled, so we call the GraphQL endpoint directly through
// the same authenticated `request()` — it reuses the installation token hook.

type DiscussionGQL = {
  number: number
  title: string
  body: string
  url: string
  author: { login: string } | null
  answer: { body: string; author: { login: string } | null } | null
}

function discussionSourceFilename(owner: string, repo: string): string {
  return `${owner}/${repo}#discussions`
}

type DiscussionsPageResult = {
  repository: {
    discussions: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes: DiscussionGQL[]
    }
  }
}

type DiscussionByNumberResult = {
  repository: { discussion: DiscussionGQL | null }
}

// @octokit/rest has no bundled GraphQL plugin, so we grab the installation
// token off the same authenticated client and hit the GraphQL endpoint
// directly rather than pulling in another dependency for one query.
async function githubGraphql<T>(
  octokit: Awaited<ReturnType<typeof getInstallationOctokit>>,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const { token } = await (octokit.auth as (opts: { type: string }) => Promise<{ token: string }>)({ type: 'installation' })

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  })

  const body = (await res.json()) as { data: T; errors?: Array<{ message: string }> }
  if (!res.ok || body.errors?.length) {
    throw new Error(body.errors?.map((e) => e.message).join('; ') ?? `GitHub GraphQL request failed: ${res.status}`)
  }
  return body.data
}

function buildDiscussionArticle(d: DiscussionGQL): { question: string; answer: string } | null {
  if (!d.answer || !d.answer.body.trim()) return null
  const authorLogin = d.answer.author?.login ?? 'unknown'
  const answer = `${d.answer.body}\n\n— Answered by @${authorLogin} on GitHub Discussions`
  return { question: d.title, answer }
}

const DISCUSSIONS_PAGE_QUERY = `
  query($owner: String!, $repo: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      discussions(first: 50, after: $cursor, answered: true, orderBy: {field: UPDATED_AT, direction: DESC}) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number
          title
          body
          url
          author { login }
          answer {
            body
            author { login }
          }
        }
      }
    }
  }
`

const DISCUSSION_BY_NUMBER_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      discussion(number: $number) {
        number
        title
        body
        url
        author { login }
        answer {
          body
          author { login }
        }
      }
    }
  }
`

/**
 * Full backfill: replaces the repo's discussions KB source with every
 * currently-answered discussion. Run manually or after connecting a repo.
 */
export async function syncDiscussionsToKB(
  repoId: number,
  owner: string,
  repo: string,
  installationId: number,
  orgId: number,
  opts: KbSyncProgressOpts = {}
): Promise<number> {
  const octokit = await getInstallationOctokit(owner, repo, orgId)

  const discussions: DiscussionGQL[] = []
  let cursor: string | null = null
  while (discussions.length < MAX_DISCUSSIONS) {
    const data: DiscussionsPageResult = await githubGraphql<DiscussionsPageResult>(octokit, DISCUSSIONS_PAGE_QUERY, { owner, repo, cursor })
    const conn = data.repository.discussions
    discussions.push(...conn.nodes)
    if (!conn.pageInfo.hasNextPage) break
    cursor = conn.pageInfo.endCursor
  }

  logger.info('github discussion kb sync started', { module: MOD, owner, repo, count: discussions.length })

  const sourceFilename = discussionSourceFilename(owner, repo)
  const staging = stagingFilename(sourceFilename)
  const existing = await getKBSourceByFilename(orgId, sourceFilename)
  const existingCount = existing ? await countArticlesForSource(existing.id, orgId) : 0

  await deleteKBSourcesByFilename(orgId, staging)

  const budget = Math.max(0, MAX_ARTICLES_PER_ORG - ((await countArticles(orgId)) - existingCount))
  if (budget === 0) {
    logger.warn('kb full — skipping github discussion sync', { module: MOD, orgId })
    return existingCount
  }

  const source = await createKBSource({ orgId, filename: staging, fileType: 'github-discussion', sizeBytes: 0, published: 0 })

  const toSync = discussions.slice(0, MAX_DISCUSSIONS)
  let created = 0
  let answered = 0
  try {
    for (let di = 0; di < toSync.length; di++) {
      const d = toSync[di]
      opts.onProgress?.(di, toSync.length)
      if (created >= budget) break
      const article = buildDiscussionArticle(d)
      if (!article) continue
      answered++
      try {
        const { embedding, model } = await embedTextWithModel(`${article.question}\n\n${article.answer}`, orgId)
        await createArticleFromSource(
          { question: article.question, answer: article.answer, embedding, model, sourceId: source.id, sourcePage: d.number, published: 0 },
          orgId
        )
        created++
      } catch (err) {
        if (err instanceof NoAIProviderConfiguredError) throw err
        logger.warn('discussion embed failed', { module: MOD, number: d.number, error: err })
      }
    }
    opts.onProgress?.(toSync.length, toSync.length)

    if (created === 0 && answered > 0 && existingCount > 0) {
      throw new KbSyncUserError(NOTHING_IMPORTED_MESSAGE)
    }
  } catch (err) {
    await cleanupStaging(orgId, source.id, err)
    throw err
  }

  await assertStagingPresent(orgId, staging, source.id)
  await updateKBSourceChunkCount(source.id, created)
  await swapKBSource({
    orgId,
    newSourceId: source.id,
    targetFilename: sourceFilename,
    published: existing ? existing.published : 1,
    flagRelatedResolutions: true,
  })

  // The repo's chunk total is its files source plus its discussions source.
  const filesSource = await getKBSourceByFilename(orgId, `${owner}/${repo}`)
  await updateRepoSettings(repoId, orgId, {
    kbLastSynced: new Date().toISOString(),
    kbChunkCount: (filesSource?.chunk_count ?? 0) + created,
  })

  logger.info('github discussion kb sync done', { module: MOD, owner, repo, created })
  return created
}

/**
 * Incremental webhook path: upserts (or removes) the single discussion's KB
 * article when it's marked answered / unanswered, without touching the rest
 * of the repo's discussions source.
 */
export async function syncSingleDiscussionToKB(
  owner: string,
  repo: string,
  orgId: number,
  discussionNumber: number
): Promise<void> {
  const octokit = await getInstallationOctokit(owner, repo, orgId)
  const data = await githubGraphql<DiscussionByNumberResult>(octokit, DISCUSSION_BY_NUMBER_QUERY, { owner, repo, number: discussionNumber })
  const discussion = data.repository.discussion
  if (!discussion) return

  const sourceFilename = discussionSourceFilename(owner, repo)
  const source = await getOrCreateKBSource({ orgId, filename: sourceFilename, fileType: 'github-discussion' })

  const article = buildDiscussionArticle(discussion)
  if (!article) {
    await deleteArticleBySourceAndPage(source.id, discussion.number, orgId)
    await updateKBSourceChunkCount(source.id, await countArticlesForSource(source.id, orgId))
    logger.info('github discussion kb sync — answer removed, article dropped', { module: MOD, owner, repo, number: discussion.number })
    return
  }

  const { embedding, model } = await embedTextWithModel(`${article.question}\n\n${article.answer}`, orgId)
  await upsertArticleFromSource(
    { question: article.question, answer: article.answer, embedding, model, sourceId: source.id, sourcePage: discussion.number },
    orgId
  )
  await updateKBSourceChunkCount(source.id, await countArticlesForSource(source.id, orgId))

  logger.info('github discussion kb sync — upserted', { module: MOD, owner, repo, number: discussion.number })
}
