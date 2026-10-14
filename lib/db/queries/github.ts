import { eq, and, desc } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { githubRepos } from '../schema'
import type { GitHubRepo } from '@/types'

function toRepo(row: typeof githubRepos.$inferSelect): GitHubRepo {
  return {
    id: row.id,
    org_id: row.orgId,
    installation_id: row.installationId,
    owner: row.owner,
    repo: row.repo,
    is_private: row.isPrivate as 0 | 1,
    monitored_events: row.monitoredEvents,
    kb_enabled: row.kbEnabled as 0 | 1,
    kb_last_synced: row.kbLastSynced ?? null,
    kb_chunk_count: row.kbChunkCount,
    auto_deflect_enabled: row.autoDeflectEnabled as 0 | 1,
    added_at: row.addedAt,
  }
}

export async function getRepos(orgId: number): Promise<GitHubRepo[]> {
  const rows = await getDb()
    .select()
    .from(githubRepos)
    .where(eq(githubRepos.orgId, orgId))
    .orderBy(desc(githubRepos.addedAt))
  return rows.map(toRepo)
}

export class GithubRepoTakenError extends Error {
  constructor(owner: string, repo: string) {
    super(`GitHub repository ${owner}/${repo} is already connected to another answerLoops org`)
    this.name = 'GithubRepoTakenError'
  }
}

/**
 * Connects a repository to an org. A repository belongs to one org (unique on
 * owner + repo): re-adding it for the org that already owns it refreshes the
 * installation id and visibility; if a different org owns it this throws
 * {@link GithubRepoTakenError} rather than touching that org's row.
 */
export async function addRepo(
  installationId: number,
  owner: string,
  repo: string,
  isPrivate: boolean,
  orgId: number
): Promise<GitHubRepo> {
  const db = getDb()
  const [existing] = await db
    .select()
    .from(githubRepos)
    .where(and(eq(githubRepos.owner, owner), eq(githubRepos.repo, repo)))
    .limit(1)

  if (existing) {
    if (existing.orgId !== orgId) throw new GithubRepoTakenError(owner, repo)
    const [row] = await db
      .update(githubRepos)
      .set({ installationId, isPrivate: isPrivate ? 1 : 0 })
      .where(and(eq(githubRepos.id, existing.id), eq(githubRepos.orgId, orgId)))
      .returning()
    return toRepo(row)
  }

  try {
    const [row] = await db
      .insert(githubRepos)
      .values({ orgId, installationId, owner, repo, isPrivate: isPrivate ? 1 : 0 })
      .returning()
    return toRepo(row)
  } catch (err) {
    // Lost a race with another org inserting the same repository.
    const [winner] = await db
      .select({ orgId: githubRepos.orgId })
      .from(githubRepos)
      .where(and(eq(githubRepos.owner, owner), eq(githubRepos.repo, repo)))
      .limit(1)
    if (winner && winner.orgId !== orgId) throw new GithubRepoTakenError(owner, repo)
    throw err
  }
}

export async function removeRepo(id: number, orgId: number): Promise<void> {
  await getDb()
    .delete(githubRepos)
    .where(and(eq(githubRepos.id, id), eq(githubRepos.orgId, orgId)))
}

export async function updateRepoSettings(
  id: number,
  orgId: number,
  settings: {
    monitoredEvents?: string
    kbEnabled?: number
    kbLastSynced?: string
    kbChunkCount?: number
    autoDeflectEnabled?: number
  }
): Promise<void> {
  await getDb()
    .update(githubRepos)
    .set({
      ...(settings.monitoredEvents !== undefined && { monitoredEvents: settings.monitoredEvents }),
      ...(settings.kbEnabled !== undefined && { kbEnabled: settings.kbEnabled }),
      ...(settings.kbLastSynced !== undefined && { kbLastSynced: settings.kbLastSynced }),
      ...(settings.kbChunkCount !== undefined && { kbChunkCount: settings.kbChunkCount }),
      ...(settings.autoDeflectEnabled !== undefined && { autoDeflectEnabled: settings.autoDeflectEnabled }),
    })
    .where(and(eq(githubRepos.id, id), eq(githubRepos.orgId, orgId)))
}

export async function getRepoByOwnerAndName(
  owner: string,
  repo: string
): Promise<GitHubRepo | null> {
  const [row] = await getDb()
    .select()
    .from(githubRepos)
    .where(and(eq(githubRepos.owner, owner), eq(githubRepos.repo, repo)))
    .limit(1)
  return row ? toRepo(row) : null
}

export async function getRepoById(id: number, orgId: number): Promise<GitHubRepo | null> {
  const [row] = await getDb()
    .select()
    .from(githubRepos)
    .where(and(eq(githubRepos.id, id), eq(githubRepos.orgId, orgId)))
    .limit(1)
  return row ? toRepo(row) : null
}
