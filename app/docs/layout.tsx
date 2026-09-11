import type { ReactNode } from 'react'
import Image from 'next/image'
import { RootProvider } from 'fumadocs-ui/provider/next'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { docsSource } from '@/lib/docs/source'
import { GITHUB_URL } from '@/lib/site'
import './docs.css'

// Docs are intentionally outside the dashboard's session — this layout
// nests under the app-wide RootLayout (app/layout.tsx supplies <html>/
// <body> and Geist fonts) but never touches auth. auth.ts's PUBLIC_PATHS
// includes '/docs' so proxy.ts never redirects here to /login.
export default function DocsRootLayout({ children }: { children: ReactNode }) {
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
              <Image src="/logo.png" alt="answerLoops" width={24} height={24} />
              <span className="font-semibold">answerLoops Docs</span>
            </>
          ),
          // Absolute, not relative — this is the docs site's own logo/home
          // link, meant to take you to the marketing site, not reload the
          // docs intro page you may already be on (a relative '/docs/
          // introduction' does exactly that when clicked from within docs).
          url: 'https://answerloops.com',
        }}
        githubUrl={GITHUB_URL}
        // RootProvider's theme.enabled: false above stops next-themes from
        // tracking a mode at all, but DocsLayout renders its own toggle
        // button regardless of that — a separate prop. Without this, the
        // button stays visible and clicking it does nothing (no theme
        // context to toggle), which is worse than not having the control.
        themeSwitch={{ enabled: false }}
        links={[
          {
            // Docs are mounted inside this same app now, not a separately
            // hosted Mintlify site — a relative link resolves correctly
            // wherever this is deployed (local dev, staging, prod, any
            // self-hosted domain) instead of hardcoding one specific
            // production hostname that breaks everywhere else.
            text: 'Dashboard',
            url: '/dashboard',
          },
        ]}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  )
}
