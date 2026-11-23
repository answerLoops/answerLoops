import type { GitHubRepo } from '@/types'
import { commitLinkInfo } from '@/lib/github/commit-link'
import { DOCS_FOLDERS_NUDGE, folderLabel, missingFolderLine, syncShortfalls } from '@/lib/github/sync-summary'

/**
 * "N chunks · last synced <date> · docs at <sha>" for a connected repo, then
 * the docs folders it syncs (or a nudge to choose them), any chosen folder
 * that has gone from the repo, and files the last sync left out. The sha is
 * the commit the last files sync read, linked to that commit on GitHub. Repos
 * synced before the sha was recorded show the date alone until their next
 * sync. Lines are spans so the component can sit inside a paragraph.
 */
export function RepoSyncStatus({
  repo,
}: {
  repo: Pick<GitHubRepo, 'owner' | 'repo' | 'kb_chunk_count' | 'kb_last_synced' | 'kb_synced_commit' | 'kb_paths' | 'kb_sync_result'>
}) {
  const commit = commitLinkInfo(repo.owner, repo.repo, repo.kb_synced_commit)
  const result = repo.kb_sync_result
  const shortfalls = result ? syncShortfalls(result) : []
  return (
    <>
      {repo.kb_chunk_count <= 0 && !repo.kb_last_synced ? (
        <>Not yet synced</>
      ) : (
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
      )}
      <span className="block break-words">
        {repo.kb_paths ? `Docs folders: ${repo.kb_paths.map(folderLabel).join(', ')}` : DOCS_FOLDERS_NUDGE}
      </span>
      {result?.missingFolders.map((folder) => (
        <span key={folder} className="block break-words text-amber-700">
          {missingFolderLine(folder)}
        </span>
      ))}
      {shortfalls.length > 0 && <span className="block text-amber-700">{shortfalls.join(' · ')}</span>}
    </>
  )
}
