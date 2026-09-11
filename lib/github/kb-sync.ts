import { getInstallationOctokit } from './app'
import type { KbSyncProgressOpts } from '@/lib/kb-sync/progress'
import { chunkMarkdown } from '@/lib/ingest/url'
import { embedText, EMBEDDING_MODEL } from '@/lib/ai/embed'
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
  updateKBSourceChunkCount,
} from '@/lib/db/queries/kb-sources'
import { updateRepoSettings, getRepoById } from '@/lib/db/queries/github'
import { logger } from '@/lib/logger'

const MOD = 'github/kb-sync'
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

  // Delete existing source for this repo to avoid duplicate chunks on re-sync
  const sourceFilename = `${owner}/${repo}`
  const existing = await getKBSourceByFilename(orgId, sourceFilename)
  if (existing) {
    await deleteKBSource(existing.id, orgId)
  }

  const currentCount = await countArticles(orgId)
  const budget = Math.max(0, MAX_ARTICLES_PER_ORG - currentCount)
  if (budget === 0) {
    logger.warn('kb full — skipping github sync', { module: MOD, orgId })
    return 0
  }

  const source = await createKBSource({
    orgId,
    filename: sourceFilename,
    fileType: 'github',
    sizeBytes: 0,
  })

  let created = 0

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
          const embedding = await embedText(`${chunk.question}\n\n${chunk.answer}`, orgId)
          await createArticleFromSource({ question: chunk.question, answer: chunk.answer, embedding, model: EMBEDDING_MODEL, sourceId: source.id }, orgId)
          created++
        } catch (err) {
          logger.warn('chunk embed failed', { module: MOD, path: file.path, error: err })
        }
      }
    } catch (err) {
      logger.warn('file fetch failed', { module: MOD, path: file.path, error: err })
    }
  }

  opts.onProgress?.(mdFiles.length, mdFiles.length)

  await updateKBSourceChunkCount(source.id, created)
  await updateRepoSettings(repoId, orgId, {
    kbLastSynced: new Date().toISOString(),
    kbChunkCount: created,
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
  const existing = await getKBSourceByFilename(orgId, sourceFilename)
  if (existing) {
    await deleteKBSource(existing.id, orgId)
  }

  const currentCount = await countArticles(orgId)
  const budget = Math.max(0, MAX_ARTICLES_PER_ORG - currentCount)
  if (budget === 0) {
    logger.warn('kb full — skipping github discussion sync', { module: MOD, orgId })
    return 0
  }

  const source = await createKBSource({ orgId, filename: sourceFilename, fileType: 'github-discussion', sizeBytes: 0 })

  const toSync = discussions.slice(0, MAX_DISCUSSIONS)
  let created = 0
  for (let di = 0; di < toSync.length; di++) {
    const d = toSync[di]
    opts.onProgress?.(di, toSync.length)
    if (created >= budget) break
    const article = buildDiscussionArticle(d)
    if (!article) continue
    try {
      const embedding = await embedText(`${article.question}\n\n${article.answer}`, orgId)
      await createArticleFromSource(
        { question: article.question, answer: article.answer, embedding, model: EMBEDDING_MODEL, sourceId: source.id, sourcePage: d.number },
        orgId
      )
      created++
    } catch (err) {
      logger.warn('discussion embed failed', { module: MOD, number: d.number, error: err })
    }
  }

  opts.onProgress?.(toSync.length, toSync.length)

  await updateKBSourceChunkCount(source.id, created)

  const repoRow = await getRepoById(repoId, orgId)
  await updateRepoSettings(repoId, orgId, {
    kbLastSynced: new Date().toISOString(),
    kbChunkCount: (repoRow?.kb_chunk_count ?? 0) - (existing?.chunk_count ?? 0) + created,
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

  const embedding = await embedText(`${article.question}\n\n${article.answer}`, orgId)
  await upsertArticleFromSource(
    { question: article.question, answer: article.answer, embedding, model: EMBEDDING_MODEL, sourceId: source.id, sourcePage: discussion.number },
    orgId
  )
  await updateKBSourceChunkCount(source.id, await countArticlesForSource(source.id, orgId))

  logger.info('github discussion kb sync — upserted', { module: MOD, owner, repo, number: discussion.number })
}
