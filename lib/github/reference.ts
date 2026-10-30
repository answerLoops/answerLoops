export interface GithubReference {
  kind: 'issue' | 'discussion'
  owner: string
  repo: string
  number: number
  /** Short form shown next to a ticket: `owner/repo#123`. */
  short: string
  /** Form that says what it is: `Issue owner/repo#123` or `Discussion owner/repo#45`. */
  label: string
  url: string
}

const NUMBER = /^\d+$/

/**
 * The issue or discussion a GitHub ticket belongs to, read from ids the ticket
 * already stores. The ticket's own message id names it when the ticket opened
 * with the issue or discussion; a ticket opened by a comment names it through
 * its thread id instead, so the number shown is the parent's, never the
 * comment's. Owner and repo come from the channel (`owner/repo`) because both
 * can contain hyphens. Returns null when nothing parses, so callers render
 * nothing rather than a broken link.
 */
export function githubReference(ticket: {
  source_message_id: string | null
  source_thread_id?: string | null
  source_channel_id: string | null
}): GithubReference | null {
  const channel = ticket.source_channel_id
  const slash = channel?.indexOf('/') ?? -1
  if (!channel || slash < 1 || slash === channel.length - 1) return null
  const owner = channel.slice(0, slash)
  const repo = channel.slice(slash + 1)
  if (repo.includes('/')) return null

  for (const id of [ticket.source_message_id, ticket.source_thread_id]) {
    if (!id) continue
    for (const kind of ['issue', 'discussion'] as const) {
      const head = `github-${kind}-${owner}-${repo}-`
      if (!id.startsWith(head)) continue
      const digits = id.slice(head.length)
      if (!NUMBER.test(digits)) continue
      const number = Number(digits)
      const short = `${owner}/${repo}#${number}`
      return {
        kind,
        owner,
        repo,
        number,
        short,
        label: `${kind === 'issue' ? 'Issue' : 'Discussion'} ${short}`,
        url: `https://github.com/${owner}/${repo}/${kind === 'issue' ? 'issues' : 'discussions'}/${number}`,
      }
    }
  }
  return null
}
