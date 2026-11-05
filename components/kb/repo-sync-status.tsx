import type { GitHubRepo } from '@/types'
import { commitLinkInfo } from '@/lib/github/commit-link'

/**
 * "N chunks · last synced <date> · docs at <sha>" for a connected repo. The
 * sha is the commit the last files sync read, linked to that commit on GitHub.
 * Repos synced before the sha was recorded show the date alone until their
 * next sync.
 */
export function RepoSyncStatus({
  repo,
}: {
  repo: Pick<GitHubRepo, 'owner' | 'repo' | 'kb_chunk_count' | 'kb_last_synced' | 'kb_synced_commit'>
}) {
  if (repo.kb_chunk_count <= 0) return <>Not yet synced</>
  const commit = commitLinkInfo(repo.owner, repo.repo, repo.kb_synced_commit)
  return (
    <>
      {repo.kb_chunk_count} chunks · last synced{' '}
      {repo.kb_last_synced ? new Date(repo.kb_last_synced).toLocaleDateString() : 'never'}
      {commit && (
        <>
          {' '}· docs at{' '}
          <a
            href={commit.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-indigo-600 hover:underline"
            title="The commit this knowledge was built from"
          >
            {commit.short}
          </a>
        </>
      )}
    </>
  )
}
