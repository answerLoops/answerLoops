import type { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { getRepoById } from '@/lib/db/queries/github'
import { getInstallationOctokit } from '@/lib/github/app'
import { listDocFolders, defaultSelection, isExcludedFolder, selectDocFiles, toTreeEntries } from '@/lib/github/doc-folders'
import { rateLimitShared } from '@/lib/ratelimit'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/github/repos/[id]/doc-folders'

/**
 * The folders of a connected repository with how many docs files each holds,
 * for the docs folder picker. Read from the repository's head commit, the same
 * tree a sync reads, so the counts match what a sync takes.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return Response.json({ error: access.error }, { status: access.error === 'Unauthorized' ? 401 : 403 })
  const orgId = access.orgId

  const { id } = await ctx.params
  const repoId = Number(id)
  if (!Number.isInteger(repoId) || repoId <= 0) return Response.json({ error: 'Invalid repository' }, { status: 400 })

  const limit = await rateLimitShared(`doc-folders:${orgId}`, 30, 10 * 60_000)
  if (!limit.ok) {
    const mins = Math.ceil(limit.retryAfterMs / 60_000)
    return Response.json({ error: `Rate limit reached. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` }, { status: 429 })
  }

  const repo = await getRepoById(repoId, orgId)
  if (!repo) return Response.json({ error: 'Repo not found' }, { status: 404 })

  try {
    const octokit = await getInstallationOctokit(repo.owner, repo.repo, orgId)
    const { data: head } = await octokit.rest.repos.getCommit({ owner: repo.owner, repo: repo.repo, ref: 'HEAD' })
    const { data: tree } = await octokit.rest.git.getTree({ owner: repo.owner, repo: repo.repo, tree_sha: head.sha, recursive: '1' })
    const entries = toTreeEntries(tree.tree)
    const folders = listDocFolders(entries)
    const truncated = !!tree.truncated
    const usingDefaults = repo.kb_paths === null
    // Saved folders that are now hidden or excluded are no longer offered, so they aren't pre-ticked.
    const selected = usingDefaults ? defaultSelection(folders) : repo.kb_paths!.filter((p) => !isExcludedFolder(p))
    // A truncated tree may simply not show a folder, so it is never called gone.
    const missing = usingDefaults || truncated ? [] : selectDocFiles(entries, selected).missingFolders
    return Response.json({ folders, selected, usingDefaults, missing, truncated })
  } catch (err) {
    logger.error('could not list repo docs folders', { module: MOD, requestId: getRequestId(req), orgId, repoId, error: err })
    return Response.json({ error: 'Could not read the repository. Try again shortly.' }, { status: 502 })
  }
}
