import Link from 'next/link'
import { LogoMark } from '@/components/logo'
import { MobileDrawer } from '@/components/ui/mobile-drawer'
import { NavCta } from './nav-cta'
import { GITHUB_URL } from '@/lib/site'
import type { NavState } from './nav-shared'
export { GITHUB_URL } from '@/lib/site'
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
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <path d="M9 19c-4 1-4-2-6-2m12 4v-4a3 3 0 0 0-1-2.3c3-.3 6-1.4 6-6A4.7 4.7 0 0 0 19 5a4.3 4.3 0 0 0-.1-3S17.7 1.7 15 3a13.4 13.4 0 0 0-6 0C6.3 1.7 5.1 2 5.1 2A4.3 4.3 0 0 0 5 5a4.7 4.7 0 0 0-1 3.7c0 4.6 3 5.7 6 6A3 3 0 0 0 9 17v4" />
  </svg>
)
export function NavWordmark() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark size={28} />
      <span className="text-base font-semibold tracking-tight">
        answer<span className="text-blue-600">Loops</span>
      </span>
    </span>
  )
}
const NAV = [
  ['Product', '/#features'],
  ['Integrations', '/#integrations'],
  ['Pricing', '/pricing'],
  ['Docs', '/docs'],
  ['About', '/about'],
]
export function Nav({ state }: { state?: NavState }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <Link href="/" aria-label="AnswerLoops home" className="shrink-0">
          <NavWordmark />
        </Link>
        <nav
          aria-label="Main navigation"
          className="hidden items-center gap-6 lg:flex"
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
        <div className="flex items-center gap-2">
          <NavCta variant="header" initialState={state} />
          <MobileDrawer
            triggerLabel="Open navigation"
            triggerClassName="lg:hidden"
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
      ['Contact', 'mailto:hello@answerloops.com'],
      ['GitHub', GITHUB_URL],
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
              Support replies from your documentation, with review controls for
              your team.
            </p>
            <p className="mt-3 text-sm text-slate-600">
              Open source. Hosted or self-hosted.
            </p>
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
          <p>© 2026 AnswerLoops</p>
          <div className="flex flex-wrap gap-5">
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
