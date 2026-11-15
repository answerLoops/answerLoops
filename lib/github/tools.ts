import { getInstallationOctokit } from './app'
import { logger } from '@/lib/logger'

const MOD = 'github-tools'

/**
 * What the model is told when a repository tool call fails.
 *
 * The result of a tool call goes back into the model's context, so whatever we
 * return here can end up quoted in a draft the customer sees. Raw error text
 * (installation ids, API URLs, "not configured" messages, stack fragments) must
 * never travel that way. The full error is logged server-side instead.
 */
const REPO_UNAVAILABLE = 'The repository could not be read right now. Do not guess its contents.'
const NOT_FOUND = 'No file or directory exists at that path.'

function statusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : undefined
}

function failure(tool: string, repo: string, orgId: number, err: unknown, extra: Record<string, unknown> = {}) {
  const status = statusOf(err)
  logger.warn('repository tool call failed', { module: MOD, tool, repo, orgId, status, error: err, ...extra })
  // A missing path is an ordinary answer the model can act on (try another path).
  return { error: status === 404 && tool !== 'searchCode' ? NOT_FOUND : REPO_UNAVAILABLE }
}

export async function searchCode(query: string, repo: string, orgId: number) {
  const [owner, name] = repo.split('/')
  try {
    const octokit = await getInstallationOctokit(owner, name, orgId)
    const { data } = await octokit.rest.search.code({
      q: `${query} repo:${repo}`,
      per_page: 5,
    })
    return data.items.map((item) => ({
      path: item.path,
      url: item.html_url,
      sha: item.sha,
      fragment: (item as { text_matches?: Array<{ fragment?: string }> }).text_matches?.[0]?.fragment ?? '',
    }))
  } catch (err) {
    return failure('searchCode', repo, orgId, err)
  }
}

export async function readFile(path: string, repo: string, orgId: number, ref = 'main') {
  const [owner, name] = repo.split('/')
  try {
    const octokit = await getInstallationOctokit(owner, name, orgId)
    const { data } = await octokit.rest.repos.getContent({ owner, repo: name, path, ref })
    if ('content' in data && typeof data.content === 'string') {
      const content = Buffer.from(data.content, 'base64').toString('utf8')
      // Cap at 8k chars to keep context manageable
      return content.length > 8000 ? content.slice(0, 8000) + '\n... (truncated)' : content
    }
    return { error: 'Not a file or no content' }
  } catch (err) {
    return failure('readFile', repo, orgId, err, { path, ref })
  }
}

export async function listFiles(path: string, repo: string, orgId: number) {
  const [owner, name] = repo.split('/')
  try {
    const octokit = await getInstallationOctokit(owner, name, orgId)
    const { data } = await octokit.rest.repos.getContent({ owner, repo: name, path })
    if (Array.isArray(data)) {
      return data.map((f) => ({ name: f.name, type: f.type, path: f.path, size: f.size }))
    }
    return { error: 'Not a directory' }
  } catch (err) {
    return failure('listFiles', repo, orgId, err, { path })
  }
}
