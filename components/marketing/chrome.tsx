import Link from 'next/link'
import { LogoMark } from '@/components/logo'
import { MobileDrawer } from '@/components/ui/mobile-drawer'
import { NavCta } from '@/components/marketing/nav-cta'

// Re-exported so the many marketing pages that already import it from here keep
// working, while lib/site.ts stays the single definition.
export { GITHUB_URL } from '@/lib/site'
import { GITHUB_URL } from '@/lib/site'

// The CTA state type + mapping now live in a component-free module so the
// client CTA island and this server shell share them without an import cycle.
// Re-exported here because many marketing pages import them from chrome.
export { navState } from '@/components/marketing/nav-shared'
export type { NavState } from '@/components/marketing/nav-shared'
import type { NavState } from '@/components/marketing/nav-shared'

export const GithubIcon = ({ className = 'h-4 w-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.167 6.839 9.49.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.744 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
  </svg>
)

export function NavWordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={30} />
      <span className="text-lg font-semibold tracking-tight">
        <span className="text-white">answer</span>
        <span className="bg-gradient-to-r from-brand-400 to-indigo-400 bg-clip-text text-transparent">Loops</span>
      </span>
    </span>
  )
}

// Deep link to the plan cards, not to /pricing itself: a header button whose
// only effect is re-rendering the page the visitor is already on reads as
// broken, and choosing a plan is the action they are actually here for.
export const PLANS_HREF = '/pricing#plans'

/**
 * The marketing header.
 *
 * `state` is optional. When a caller resolves the session server-side
 * (/pricing, which needs it for its own resume logic) it's passed through and
 * the CTA renders that state with no client round-trip. When it's omitted the
 * page is static and the `NavCta` island fills in the personalized CTA after
 * hydration via /api/nav-state — so crawlers and first paint never pay for a
 * per-request session read, which is what used to force every marketing page
 * to `dynamic = 'force-dynamic'` and left Cloudflare nothing to cache.
 */
export function Nav({ state }: { state?: NavState }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 sm:px-8">
        {/* Gaps tighten at md and relax again at lg. md is where the desktop
            nav appears while the header still has the least room for it, and
            the row is at its most crowded there — every item is nowrap, so
            without this the nav is the only thing that can give, and it gives
            by wrapping a link onto a second line. */}
        <div className="flex items-center gap-6 lg:gap-9">
          <Link href="/">
            <span className="flex items-center gap-2.5">
              <LogoMark size={32} />
              {/* The wordmark does not wrap or truncate, so on the narrowest
                  phones it ran underneath the CTA button. Below ~394px there is
                  not room for mark + wordmark + CTA + menu, and the mark alone
                  still identifies the site. */}
              <span className="hidden text-[1.18125rem] font-semibold tracking-tight min-[394px]:inline">
                <span className="text-slate-950">answer</span>
                <span className="bg-gradient-to-r from-brand-400 to-indigo-400 bg-clip-text text-transparent">Loops</span>
              </span>
            </span>
          </Link>
          <nav className="hidden items-center gap-5 md:flex lg:gap-7">
            <Link href="/#features" className="whitespace-nowrap text-[0.7875rem] font-medium text-slate-600 transition-colors hover:text-slate-950">Product</Link>
            <Link href="/#how-it-works" className="whitespace-nowrap text-[0.7875rem] font-medium text-slate-600 transition-colors hover:text-slate-950">How it works</Link>
            <Link href="/pricing" className="whitespace-nowrap text-[0.7875rem] font-medium text-slate-600 transition-colors hover:text-slate-950">Pricing</Link>
            <a href="/docs" target="_blank" rel="noopener noreferrer" className="whitespace-nowrap text-[0.7875rem] font-medium text-slate-600 transition-colors hover:text-slate-950">Docs</a>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {/* The CTA is a client island: on a static marketing page it paints
              the anonymous pair, then swaps to the dashboard / choose-a-plan
              link after asking /api/nav-state. On /pricing, `state` is passed
              and it renders that verbatim with no round-trip. The loop this
              guards against — offering a no-plan visitor the dashboard the
              access gate immediately bounces — lives in NavCta now. */}
          <NavCta variant="header" initialState={state} />
          <MobileDrawer triggerLabel="Open navigation" triggerClassName="md:hidden">
            <nav className="flex flex-col p-4 gap-1">
              <Link href="/#features" className="rounded-lg px-3 py-2.5 text-[0.91875rem] font-medium text-ink-600 hover:bg-gray-100">Features</Link>
              <Link href="/#how-it-works" className="rounded-lg px-3 py-2.5 text-[0.91875rem] font-medium text-ink-600 hover:bg-gray-100">How it works</Link>
              <Link href="/pricing" className="rounded-lg px-3 py-2.5 text-[0.91875rem] font-medium text-ink-600 hover:bg-gray-100">Pricing</Link>
              <a href="/docs" target="_blank" rel="noopener noreferrer" className="rounded-lg px-3 py-2.5 text-[0.91875rem] font-medium text-ink-600 hover:bg-gray-100">Docs</a>
              {/* Both halves of the anonymous pair, since the header hides them
                  below sm — without these the drawer is the only navigation on
                  a phone and offers no way to sign in at all. */}
              <NavCta variant="drawer" initialState={state} />
            </nav>
          </MobileDrawer>
        </div>
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="border-t border-white/8 bg-[#030611] text-white">
      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
        <div className="flex flex-col md:flex-row items-start justify-between gap-8">
          <div>
            <div className="mb-4"><NavWordmark /></div>
            <p className="max-w-xs text-xs leading-relaxed text-white/50">Confidence-gated AI support that lives in your community. Open source and self-hostable.</p>
            <div className="mt-4 flex items-center gap-1.5 text-xs text-white/50">
              <GithubIcon className="h-3 w-3" />
              <Link href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="text-sm font-medium transition-colors hover:text-white/85">Proudly open source</Link>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-12 gap-y-6">
            <div>
              <div className="mb-3 text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-white/60">Product</div>
              <div className="flex flex-col gap-2">
                <Link href="/#features" className="text-xs text-white/50 transition-colors hover:text-white/85">Features</Link>
                <Link href="/#how-it-works" className="text-xs text-white/50 transition-colors hover:text-white/85">How it works</Link>
                <Link href="/agentic-support" className="text-xs text-white/50 transition-colors hover:text-white/85">Agentic support</Link>
                <Link href="/pricing" className="text-xs text-white/50 transition-colors hover:text-white/85">Pricing</Link>
              </div>
            </div>
            <div>
              <div className="mb-3 text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-white/60">Compare</div>
              <div className="flex flex-col gap-2">
                <Link href="/alternatives" className="text-xs text-white/50 transition-colors hover:text-white/85">All alternatives</Link>
                <Link href="/vs/intercom" className="text-xs text-white/50 transition-colors hover:text-white/85">vs Intercom</Link>
                <Link href="/vs/zendesk-ai" className="text-xs text-white/50 transition-colors hover:text-white/85">vs Zendesk AI</Link>
                <Link href="/vs/chatbase" className="text-xs text-white/50 transition-colors hover:text-white/85">vs Chatbase</Link>
                <Link href="/vs/pylon" className="text-xs text-white/50 transition-colors hover:text-white/85">vs Pylon</Link>
                <Link href="/vs/plain" className="text-xs text-white/50 transition-colors hover:text-white/85">vs Plain</Link>
              </div>
            </div>
            <div>
              <div className="mb-3 text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-white/60">Company</div>
              <div className="flex flex-col gap-2">
                <Link href="/about" className="text-xs text-white/50 transition-colors hover:text-white/85">About</Link>
                <Link href="/blog" className="text-xs text-white/50 transition-colors hover:text-white/85">Blog</Link>
              </div>
            </div>
            <div>
              <div className="mb-3 text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-white/60">Open source</div>
              <div className="flex flex-col gap-2">
                <Link href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="text-xs text-white/50 transition-colors hover:text-white/85">GitHub</Link>
                <Link href="/docs" target="_blank" rel="noopener noreferrer" className="text-xs text-white/50 transition-colors hover:text-white/85">Docs</Link>
                <Link href={`${GITHUB_URL}/issues`} target="_blank" rel="noopener noreferrer" className="text-xs text-white/50 transition-colors hover:text-white/85">Issues</Link>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-white/8 pt-6 sm:flex-row">
          <p className="text-[0.625rem] text-white/40">© 2026 AnswerLoops. Open source.</p>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="text-[0.625rem] text-white/40 transition-colors hover:text-white/70">Privacy Policy</Link>
            <Link href="/terms" className="text-[0.625rem] text-white/40 transition-colors hover:text-white/70">Terms of Service</Link>
            <p className="text-[0.625rem] text-white/40">Built in public · Self-hostable</p>
          </div>
        </div>
      </div>
    </footer>
  )
}
