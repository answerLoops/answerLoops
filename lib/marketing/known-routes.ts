import { isPlatformPath } from './platform-paths'
import { isWebsitePath } from './website-paths'

/**
 * Whether this app serves anything at `pathname`: a website page, a platform
 * page, the API, the widget, or one of the `publicPaths` auth.ts exempts from
 * sign-in (webhooks, the public documents, ...). A path that is none of those
 * has no page behind it. Takes the public list as an argument so it stays
 * pure, and so the one copy of that list stays in auth.ts.
 */
export function isKnownRoute(pathname: string, publicPaths: readonly string[]): boolean {
  return (
    isWebsitePath(pathname) ||
    isPlatformPath(pathname) ||
    publicPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/widget')
  )
}
