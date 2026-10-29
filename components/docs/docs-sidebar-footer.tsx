import type { ReactNode } from 'react'

/**
 * The foot of the docs sidebar: a quiet Changelog entry, kept out of the header
 * so the top of the page stays about getting in (Log in, Start trial). It is
 * also shown in the mobile drawer, where Fumadocs renders the same footer.
 *
 * `changelogUrl` is null on a self-hosted install, which serves no /changelog;
 * nothing renders then, so there is no dead link and no empty gap. The address
 * is absolute (the marketing origin), so it also works on a split-host
 * deployment, where a relative path would be answered by the app.
 */
export function DocsSidebarFooter({ changelogUrl }: { changelogUrl: string | null }): ReactNode {
  if (!changelogUrl) return null
  return (
    <a
      href={changelogUrl}
      className="mt-2 flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-fd-muted-foreground transition-colors hover:bg-fd-accent/50 hover:text-fd-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5" />
        <path d="M12 7v5l3 2" />
      </svg>
      Changelog
    </a>
  )
}
