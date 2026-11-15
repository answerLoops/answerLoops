// A full git sha is 40 lowercase hex characters. The value comes from our own
// database, but it ends up in a link, so only a well-formed sha is ever linked.
const FULL_SHA = /^[0-9a-f]{40}$/

export interface CommitLinkInfo {
  /** First seven characters, the form people recognise from git. */
  short: string
  url: string
}

export function commitLinkInfo(owner: string, repo: string, sha: string | null | undefined): CommitLinkInfo | null {
  if (!sha || !FULL_SHA.test(sha)) return null
  return {
    short: sha.slice(0, 7),
    url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commit/${sha}`,
  }
}
