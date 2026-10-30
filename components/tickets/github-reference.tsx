import type { Ticket } from '@/types'
import { githubReference } from '@/lib/github/reference'

const GITHUB_MARK =
  'M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z'

/**
 * The issue or discussion a GitHub ticket came from, as a link that reads
 * `Issue owner/repo#123`. Renders nothing when the ids do not parse.
 */
export function GithubReferenceLink({
  ticket,
  variant = 'detail',
}: {
  ticket: Pick<Ticket, 'source_message_id' | 'source_thread_id' | 'source_channel_id'>
  variant?: 'detail' | 'list'
}) {
  const ref = githubReference(ticket)
  if (!ref) return null
  const list = variant === 'list'
  return (
    <a
      href={ref.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${ref.label} on GitHub`}
      className={
        list
          ? 'mt-1 block max-w-[12rem] truncate text-xs text-gray-600 hover:text-gray-900 hover:underline'
          : 'mt-1.5 inline-flex max-w-full items-center gap-1.5 text-xs text-gray-700 hover:text-gray-900 hover:underline'
      }
    >
      {!list && (
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d={GITHUB_MARK} />
        </svg>
      )}
      <span className={list ? undefined : 'min-w-0 break-all'}>{ref.label}</span>
      {!list && <span aria-hidden="true">↗</span>}
    </a>
  )
}
