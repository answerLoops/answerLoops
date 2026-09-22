import './dashboard-theme.css'
import Link from 'next/link'
import { LogoMark } from '@/components/logo'
import { getUnreadCount } from '@/lib/db/queries/notifications'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { DashboardLive } from '@/components/dashboard/dashboard-live'
import { SidebarNav } from '@/components/dashboard/sidebar-nav'
import { MobileDrawer } from '@/components/ui/mobile-drawer'
import { AITrialBanner } from '@/components/dashboard/ai-trial-banner'
import { DeflectionStatusBanner } from '@/components/dashboard/deflection-status-banner'
import { logout } from '@/lib/actions/auth'
import { auth } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { getDeploymentMode } from '@/lib/billing/plans'
import { orgHasAIKey } from '@/lib/db/queries/ai-config'
import { getPlatformKeyTrialStatus } from '@/lib/billing/platform-key-trial'
import { listIntegrations } from '@/lib/db/queries/integrations'
import { getRepos } from '@/lib/db/queries/github'

const PLATFORM_LABEL: Record<string, string> = {
  discord: 'Discord',
  slack: 'Slack',
  google_chat: 'Google Chat',
  telegram: 'Telegram',
  email: 'Email',
}

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const orgId = session?.orgId ?? DEFAULT_ORG_ID
  const unreadCount = await getUnreadCount(orgId)

  // Self-hosted deployments never see this — their "platform key" is
  // already the self-hoster's own .env (see platformKeyAllowed in
  // lib/ai/models.ts), so there's no trial to exhaust in the first place.
  let trialStatus: { used: number; limit: number } | null = null
  if (getDeploymentMode() !== 'self-hosted' && !(await orgHasAIKey(orgId))) {
    const status = await getPlatformKeyTrialStatus(orgId)
    if (status.exhausted) trialStatus = { used: status.used, limit: status.limit }
  }

  // Same "actually connected" check the Integrations page's tab-bar dots use —
  // a row can exist without the integration being genuinely connected (e.g.
  // a Google Chat pairing started but never completed), so existence alone
  // isn't enough; enabled === 1 (plus team_id for Google Chat) is.
  const [integrations, repos] = await Promise.all([listIntegrations(orgId), getRepos(orgId)])
  const offPlatforms = integrations
    .filter((i) => i.enabled === 1 && (i.platform !== 'google_chat' || !!i.team_id) && i.auto_deflect_enabled === 0)
    .map((i) => PLATFORM_LABEL[i.platform] ?? i.platform)
  if (repos.some((r) => r.auto_deflect_enabled === 0)) offPlatforms.push('GitHub')

  const sidebarContent = (
    <>
      <div className="border-b border-slate-200 px-4 py-5">
        <Link href="/" className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition hover:bg-slate-50">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-blue-300/15 bg-blue-400/10 shadow-[inset_0_1px_rgba(255,255,255,0.06)]">
            <LogoMark size={25} />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-[-0.02em] text-slate-950">answer<span className="text-[#168fa3]">Loops</span></div>
            <div className="mt-0.5 text-[0.5625rem] font-medium uppercase tracking-[0.14em] text-slate-400">Agent operations</div>
          </div>
        </Link>
      </div>
      <SidebarNav />
    </>
  )

  return (
    <div className="dashboard-shell dashboard-theme brand-system flex h-dvh bg-[#e9eef3]">
      <DashboardLive />
      {/* Sidebar — desktop only */}
      <aside className="dashboard-sidebar hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        {sidebarContent}
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Topnav */}
        <header className="dashboard-topbar flex h-16 shrink-0 items-center border-b border-slate-200 bg-white px-3 md:px-7">
          <MobileDrawer triggerLabel="Open navigation" triggerClassName="md:hidden">
            <div className="dashboard-theme dashboard-sidebar flex h-full flex-col bg-white">{sidebarContent}</div>
          </MobileDrawer>
          <div className="ml-3 hidden items-center gap-3 md:flex">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600">
              <span className="h-1.5 w-1.5 rounded-full bg-[#168fa3]" />
            </div>
            <div>
              <p className="text-[0.625rem] font-semibold uppercase tracking-[0.15em] text-slate-400">Workspace</p>
              <p className="text-xs font-semibold text-slate-700">Support command center</p>
            </div>
          </div>
          {/* ml-auto (not justify-between) — the drawer trigger is display:none
              at md+, which removes it from flex layout entirely; with only one
              flex child left, justify-between degenerates to flex-start and
              this cluster would collapse to the header's left edge. */}
          <div className="flex items-center gap-3 ml-auto">
            <Link href="/" className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:border-blue-200 hover:text-blue-700">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6"/>
              </svg>
              Website
            </Link>
            <div className="h-5 w-px bg-slate-200" />
            <NotificationBell unreadCount={unreadCount} />
            <form action={logout}>
              <button
                type="submit"
                className="rounded-full px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="dashboard-content relative flex-1 overflow-y-auto">
          <div className="dashboard-grid pointer-events-none absolute inset-0" />
          <div className="relative mx-auto w-full max-w-[1500px] p-4 sm:p-6 md:p-8 lg:p-10">
            {trialStatus && <AITrialBanner used={trialStatus.used} limit={trialStatus.limit} />}
            <DeflectionStatusBanner offPlatforms={offPlatforms} />
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
