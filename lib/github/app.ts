import type { App } from '@octokit/app'
import { Octokit } from '@octokit/rest'
import { getRepos } from '@/lib/db/queries/github'

let appInstance: App<{ Octokit: typeof Octokit }> | null = null

async function getApp() {
  if (!appInstance) {
    const { App } = await import('@octokit/app')
    const privateKey = Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY ?? '', 'base64').toString('utf8')
    appInstance = new App({
      appId: process.env.GITHUB_APP_ID!,
      privateKey,
      Octokit,
    })
  }
  return appInstance
}

export async function getInstallationOctokit(owner: string, repo: string, orgId: number): Promise<Octokit> {
  const repos = await getRepos(orgId)
  const repoRecord = repos.find((r) => r.owner === owner && r.repo === repo)

  if (!repoRecord) {
    throw new Error(`Repository ${owner}/${repo} is not configured`)
  }

  return getInstallationOctokitById(repoRecord.installation_id)
}

export async function getConfiguredRepos(orgId: number): Promise<string[]> {
  const repos = await getRepos(orgId)
  return repos.map((r) => `${r.owner}/${r.repo}`)
}

export async function getInstallationOctokitById(installationId: number): Promise<Octokit> {
  const app = await getApp()
  return app.getInstallationOctokit(installationId)
}

export async function listInstallationRepos(installationId: number): Promise<Array<{ owner: string; repo: string; isPrivate: boolean }>> {
  const installOctokit = await getInstallationOctokitById(installationId)
  const resp = await installOctokit.request('GET /installation/repositories', {
    per_page: 100,
  })
  return (resp.data.repositories ?? []).map((r: { full_name: string; private: boolean }) => ({
    owner: r.full_name.split('/')[0],
    repo: r.full_name.split('/')[1],
    isPrivate: r.private,
  }))
}
