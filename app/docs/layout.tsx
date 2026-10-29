import type { ReactNode } from 'react'
import { LogoMark } from '@/components/logo'
import { SIGNIN_HREF, SIGNIN_LABEL, START_HREF, START_LABEL } from '@/components/marketing/nav-shared'
import { RootProvider } from 'fumadocs-ui/provider/next'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { docsSource } from '@/lib/docs/source'
import { GITHUB_SOURCE_URL } from '@/lib/site'
import { resolveChangelogUrl } from '@/lib/marketing/changelog-link'
import { DocsSidebarFooter } from '@/components/docs/docs-sidebar-footer'
import './docs.css'
import Script from 'next/script'

// Rendered per request, not at build time. The changelog link in the sidebar
// footer depends on the deployment flag, which is resolved at request time — a value
// the build machine does not have. Without this, the link would be baked in
// (or baked out) by whatever the build environment happened to be, so the
// managed deployment would ship docs with no Changelog entry. Same treatment
// as the dashboard layout, which resolves the same link per request.
//
// The cost is real and worth stating: the docs pages stop being statically
// generated. That is a deliberate trade for a correct link, not an oversight.
// The gate test in marketing-surface-gate.test.ts still holds — this file
// never names the flag, it only says why it must be read late.
export const dynamic = 'force-dynamic'

// Docs are intentionally outside the dashboard's session — this layout
// nests under the app-wide RootLayout (app/layout.tsx supplies <html>/
// <body> and Geist fonts) but never touches auth. auth.ts's PUBLIC_PATHS
// includes '/docs' so proxy.ts never redirects here to /login.
export default function DocsRootLayout({ children }: { children: ReactNode }) {
  // Local/dev-only — never hardcode a real token here. Set
  // NEXT_PUBLIC_DOCS_WIDGET_TOKEN in .env.local (gitignored) to test the
  // widget on the docs site; the script simply doesn't render without it.
  const widgetToken = process.env.NEXT_PUBLIC_DOCS_WIDGET_TOKEN

  // Null on a self-hosted install, which 404s /changelog. The gate lives in
  // the helper rather than here: documentation stays reachable on every
  // deployment, and only this one link is conditional. See the
  // marketing-surface-gate test, which asserts this file never mentions the
  // flag so a future refactor cannot quietly gate the whole docs tree.
  const changelogUrl = resolveChangelogUrl()

  return (
    <RootProvider
      // The rest of the app has no dark theme yet (docs.css's `.dark` block
      // just repeats the light values), so the toggle Fumadocs renders by
      // default changed some chrome but never the page itself — a control
      // that visibly does something but doesn't actually work. Disabling it
      // outright until a real dark palette exists beats shipping that.
      theme={{ enabled: false }}
      search={{
        options: {
          api: '/docs/api/search',
        },
      }}
    >
      <DocsLayout
        tree={docsSource.pageTree}
        nav={{
          title: (
            <>
              <LogoMark size={28} alt="answerLoops" />
              <span className="font-semibold">answerLoops</span>
              <span className="rounded-md bg-fd-accent px-1.5 py-0.5 text-xs font-medium text-fd-muted-foreground">
                Docs
              </span>
            </>
          ),
          // Absolute, not relative — this is the docs site's own logo/home
          // link, meant to take you to the marketing site, not reload the
          // docs intro page you may already be on (a relative '/docs/
          // introduction' does exactly that when clicked from within docs).
          url: 'https://answerloops.com',
        }}
        githubUrl={GITHUB_SOURCE_URL}
        // The changelog sits at the foot of the sidebar, below the GitHub
        // button, not in the header: the header is for getting in. Fumadocs
        // renders the same footer in the mobile drawer.
        sidebar={{ footer: <DocsSidebarFooter changelogUrl={changelogUrl} /> }}
        // RootProvider's theme.enabled: false above stops next-themes from
        // tracking a mode at all, but DocsLayout renders its own toggle
        // button regardless of that — a separate prop. Without this, the
        // button stays visible and clicking it does nothing (no theme
        // context to toggle), which is worse than not having the control.
        themeSwitch={{ enabled: false }}
        links={[
          // Same entry points as the marketing header, so the docs are not a
          // dead end for someone who arrived from there. Absolute campaign
          // links in production, in-app routes in local/dev (nav-shared.ts).
          { text: SIGNIN_LABEL, url: SIGNIN_HREF },
          { type: 'button', text: START_LABEL, url: START_HREF },
        ]}
      >
        {widgetToken && (
          <Script
            src="/widget.js"
            data-widget-id={widgetToken}
            strategy="lazyOnload"
          />
        )}
        {children}
      </DocsLayout>
    </RootProvider>
  )
}
