import Link from 'next/link'
import { LogoMark } from '@/components/logo'
import { MobileDrawer } from '@/components/ui/mobile-drawer'
import { NavCta } from './nav-cta'
import { GITHUB_SOURCE_URL } from '@/lib/site'
import type { NavState } from './nav-shared'
export { GITHUB_SOURCE_URL } from '@/lib/site'
export { navState } from './nav-shared'
export type { NavState } from './nav-shared'
export const PLANS_HREF = '/pricing#plans'
export const GithubIcon = ({
  className = 'h-4 w-4',
}: {
  className?: string
}) => (
  <svg
    className={className}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
)
export function NavWordmark() {
  return (
    <span className="flex shrink-0 items-center gap-3">
      <LogoMark size={32} />
      <span className="text-xl font-semibold tracking-tight sm:text-[30px]">
        answer<span className="text-[#168fa3]">Loops</span>
      </span>
    </span>
  )
}
const NAV = [
  ['Product', '/#features'],
  ['Website chat', '/#website-chat'],
  ['Integrations', '/#integrations'],
  ['Pricing', '/pricing'],
  ['Docs', '/docs'],
  ['About', '/about'],
]
export function Nav({ state }: { state?: NavState }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <Link href="/" aria-label="answerLoops home" className="shrink-0">
          <NavWordmark />
        </Link>
        <nav
          aria-label="Main navigation"
          className="hidden items-center gap-5 xl:flex"
        >
          {NAV.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="text-sm font-medium text-slate-600 hover:text-blue-700"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-3">
          <NavCta variant="header" initialState={state} />
          <MobileDrawer
            triggerLabel="Open navigation"
            triggerClassName="xl:hidden"
          >
            <nav
              aria-label="Mobile navigation"
              className="flex flex-col gap-1 p-4"
            >
              {NAV.map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded-lg px-3 py-3 text-base text-slate-700 hover:bg-slate-100"
                >
                  {label}
                </Link>
              ))}
              <NavCta variant="drawer" initialState={state} />
            </nav>
          </MobileDrawer>
        </div>
      </div>
    </header>
  )
}
const GROUPS = [
  {
    title: 'Product',
    links: [
      ['Overview', '/agentic-support'],
      ['Workflow', '/support-workflow'],
      ['Website chat widget', '/docs/product/widget'],
      ['Example', '/support-example'],
      ['Pricing', '/pricing'],
    ],
  },
  {
    title: 'Resources',
    links: [
      ['Documentation', '/docs'],
      ['Architecture', '/architecture'],
      ['Self-hosting', '/self-hosted-ai-support'],
      ['Agent access', '/mcp-support-agents'],
      ['Open-source teams', '/open-source-support'],
      ['Discord and GitHub', '/discord-github-support'],
    ],
  },
  {
    title: 'Compare',
    links: [
      ['All comparisons', '/alternatives'],
      ['Intercom', '/vs/intercom'],
      ['Zendesk AI', '/vs/zendesk-ai'],
      ['Chatbase', '/vs/chatbase'],
      ['Pylon', '/vs/pylon'],
      ['Plain', '/vs/plain'],
    ],
  },
  {
    title: 'Company',
    links: [
      ['About', '/about'],
      ['Blog', '/blog'],
      ['Community', 'https://dub.sh/github-community'],
      ['Contact', 'mailto:hello@answerloops.com'],
    ],
  },
]
export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white text-slate-900">
      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
          <div>
            <NavWordmark />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-600">
              answerLoops helps your team answer community questions using
              the documentation and resolutions you already maintain.
            </p>
            <p className="mt-3 text-sm text-slate-600">
              Use our hosted service or run it yourself.
            </p>
            <Link
              href={GITHUB_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex items-center gap-2 text-base font-medium text-slate-900 transition-colors hover:text-blue-700"
            >
              <GithubIcon className="h-5 w-5" />
              Proudly open-source
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {GROUPS.map((group) => (
              <nav key={group.title} aria-label={group.title}>
                <p className="mb-4 text-sm font-semibold">{group.title}</p>
                <ul className="space-y-3">
                  {group.links.map(([label, href]) => (
                    <li key={href}>
                      <Link
                        href={href}
                        className="text-sm text-slate-600 hover:text-blue-700"
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-4 border-t border-slate-200 pt-6 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 answerLoops</p>
          <div className="flex flex-wrap gap-5">
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
