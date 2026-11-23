import type { RepoSyncResult } from '@/types'

/**
 * Wording for what a repository files sync did. Shared by the sync job's
 * one-line result and the repo row, so the two always say the same thing.
 * Kept free of server imports so client components can use it.
 */

export const DOCS_FOLDERS_NUDGE = 'Choose your docs folders so only your docs are synced.'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The files a sync left out, one phrase each; empty when nothing was left out. */
export function syncShortfalls(result: RepoSyncResult): string[] {
  const out: string[] = []
  if (result.skippedForRoom > 0) out.push(`${plural(result.skippedForRoom, 'file', 'files')} skipped because the knowledge base is full`)
  if (result.failed > 0) out.push(`${plural(result.failed, 'file', 'files')} couldn't be read and will be retried`)
  if (result.tooLarge > 0) out.push(`${plural(result.tooLarge, 'file', 'files')} too large to sync`)
  return out
}

/** A chosen folder as the repo row names it; the root marker reads as words. */
export function folderLabel(folder: string): string {
  return folder === '.' ? 'repository root (top-level files)' : folder
}

export function missingFolderLine(folder: string): string {
  return `${folder} no longer exists in the repo`
}

/**
 * "3 files updated, 1 added, 1 removed, 140 unchanged" for an incremental
 * sync, leaving out what didn't happen ("no files changed" when nothing did);
 * null for a full rebuild.
 */
export function describeFileChanges(result: RepoSyncResult): string | null {
  if (result.updated === undefined) return null
  const clauses: [number, string][] = [
    [result.updated, 'updated'],
    [result.added ?? 0, 'added'],
    [result.removed ?? 0, 'removed'],
    [result.unchanged ?? 0, 'unchanged'],
  ]
  const parts = clauses
    .filter(([n]) => n > 0)
    .map(([n, verb], k) => (k === 0 ? `${plural(n, 'file', 'files')} ${verb}` : `${n} ${verb}`))
  return parts.length > 0 ? parts.join(', ') : 'no files changed'
}

/**
 * The job's one-line summary of a repo sync, for the owner. `discussions` is
 * null for a job that didn't sync Discussions (background re-processing).
 */
export function describeRepoSync(result: RepoSyncResult, discussions: number | null): string {
  const changes = describeFileChanges(result)
  const discussionPart = discussions === null ? null : plural(discussions, 'discussion chunk', 'discussion chunks')
  let line = changes
    ? `Docs: ${changes}${discussionPart ? `; ${discussionPart}` : ''}`
    : `Synced ${plural(result.synced, 'docs file', 'docs files')}${discussionPart ? ` and ${discussionPart}` : ''}`
  for (const shortfall of syncShortfalls(result)) line += `, ${shortfall}`
  for (const folder of result.missingFolders) line += `. ${missingFolderLine(folder)}`
  return line
}
