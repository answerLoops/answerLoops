import type { SourceFileRecord } from '@/lib/db/queries/kb-source-files'

/** A selected file and the record of its last sync, if it has one. */
export interface SyncItem {
  path: string
  sha: string
  record: SourceFileRecord | null
}

export interface RepoSyncPlan {
  /** Records whose file is no longer selected (deleted, renamed, or outside the chosen folders). */
  removed: SourceFileRecord[]
  /** Files whose content changed since the last sync. */
  edited: SyncItem[]
  /** Unchanged files processed under older cleanup rules. */
  stale: SyncItem[]
  /** Files with no record yet. */
  added: SyncItem[]
  /** Files with the same content, already processed under the current rules. */
  unchanged: number
}

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

/**
 * Works out what one repo sync has to do, by comparing the files it selected
 * (path and git blob sha) with the records it wrote last time. A content
 * change wins over an old processing version, and a rename shows up as one
 * removal and one addition. Every list is sorted by path.
 */
export function planRepoSync(selected: { path: string; sha: string }[], records: SourceFileRecord[], version: number): RepoSyncPlan {
  const recordsByPath = new Map(records.map((r) => [r.path, r]))
  const selectedPaths = new Set(selected.map((f) => f.path))
  const plan: RepoSyncPlan = { removed: [], edited: [], stale: [], added: [], unchanged: 0 }

  for (const file of selected) {
    const record = recordsByPath.get(file.path) ?? null
    if (!record) plan.added.push({ ...file, record: null })
    else if (record.blobSha !== file.sha) plan.edited.push({ ...file, record })
    else if (record.processingVersion < version) plan.stale.push({ ...file, record })
    else plan.unchanged++
  }
  for (const record of records) {
    if (!selectedPaths.has(record.path)) plan.removed.push(record)
  }

  plan.removed.sort(byPath)
  plan.edited.sort(byPath)
  plan.stale.sort(byPath)
  plan.added.sort(byPath)
  return plan
}
