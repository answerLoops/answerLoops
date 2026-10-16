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

const MOD =  'github/kb-sync'
const MAX_FILES = 100
const MAX_ARTICLES_PER_ORG = 2000
const MAX_DISCUSSIONS = 300

const EXCLUDE_PATHS = ['node_modules', 'vendor', '.github', 'test', 'tests', '__tests__', 'spec']
const EXCLUDE_FILES = ['CHANGELOG.md', 'CHANGELOG.mdx', 'LICENSE.md', 'CODE_OF_CONDUCT.md']

function shouldInclude(path: string): boolean {
  const lower = path.toLowerCase()
  if (!lower.endsWith('.md') && !lower.endsWith('.mdx')) return false
  for (const excl of EXCLUDE_PATHS) {
    if (lower.includes(`/${excl}/`) || lower.startsWith(`${excl}/`)) return false
  }
  const filename = path.split('/').pop() ?? ''
  if (EXCLUDE_FILES.includes(filename)) return false
  return true
}

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

export async function syncRepoToKB(
  repoId: number,
  owner: string,
  repo: string,
  installationId: number,
  orgId: number,
  opts: KbSyncProgressOpts = {}
): Promise<number> {
  const octokit = await getInstallationOctokit(owner, repo, orgId)

  // Get full file tree
  const { data: tree } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: 'HEAD',
    recursive: '1',
  })

  const mdFiles = (tree.tree ?? [])
    .filter((f) => f.type === 'blob' && f.path && shouldInclude(f.path))
    .slice(0, MAX_FILES)

  logger.info('github kb sync started', { module: MOD, owner, repo, fileCount: mdFiles.length })

  // The replacement is built under a staging filename and swapped in last, so
  // the live source stays intact until the new one is complete.
  const sourceFilename = `${owner}/${repo}`
  const staging = stagingFilename(sourceFilename)
  const existing = await getKBSourceByFilename(orgId, sourceFilename)
  const existingCount = existing ? await countArticlesForSource(existing.id, orgId) : 0

  // Clear any leftover staging row first so its chunks do not count against the budget.
  await deleteKBSourcesByFilename(orgId, staging)

  // The source being replaced does not count against the cap.
  const budget = Math.max(0, MAX_ARTICLES_PER_ORG - ((await countArticles(orgId)) - existingCount))
  if (budget === 0) {
    logger.warn('kb full — skipping github sync', { module: MOD, orgId })
    return existingCount
  }

  const source = await createKBSource({
    orgId,
    filename: staging,
    fileType: 'github',
    sizeBytes: 0,
    published: 0,
  })

  let created = 0
  try {
    for (let fi = 0; fi < mdFiles.length; fi++) {
      const file = mdFiles[fi]
      opts.onProgress?.(fi, mdFiles.length)
      if (created >= budget) break
      try {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path: file.path! })
        if (Array.isArray(data) || data.type !== 'file') continue

        const content = Buffer.from(data.content, 'base64').toString('utf8')
        const chunks = chunkMarkdown(content, file.path!.replace(/\.[^.]+$/, ''))

        for (const chunk of chunks) {
          if (created >= budget) break
          try {
            const { embedding, model } = await embedTextWithModel(`${chunk.question}\n\n${chunk.answer}`, orgId)
            await createArticleFromSource({ question: chunk.question, answer: chunk.answer, embedding, model, sourceId: source.id, published: 0 }, orgId)
            created++
          } catch (err) {
            if (err instanceof NoAIProviderConfiguredError) throw err
            logger.warn('chunk embed failed', { module: MOD, path: file.path, error: err })
          }
        }
      } catch (err) {
        if (err instanceof NoAIProviderConfiguredError) throw err
        logger.warn('file fetch failed', { module: MOD, path: file.path, error: err })
      }
    }
    opts.onProgress?.(mdFiles.length, mdFiles.length)

    // Files were found but not one chunk made it in (provider or network
    // trouble on every call): keep what is live rather than swapping in nothing.
    if (created === 0 && existingCount > 0 && mdFiles.length > 0) {
      throw new KbSyncUserError(NOTHING_IMPORTED_MESSAGE)
    }
  } catch (err) {
    // Build failed — bin the staging row and leave the live source alone.
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
  })
  // The repo's chunk total is its files source plus its discussions source.
  const discussionsSource = await getKBSourceByFilename(orgId, discussionSourceFilename(owner, repo))
  await updateRepoSettings(repoId, orgId, {
    kbLastSynced: new Date().toISOString(),
    kbChunkCount: created + (discussionsSource?.chunk_count ?? 0),
  })

  logger.info('github kb sync done', { module: MOD, owner, repo, created })
  return created
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
