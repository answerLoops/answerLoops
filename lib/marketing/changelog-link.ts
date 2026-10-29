import { MARKETING_URL, marketingSiteEnabled } from '@/lib/site'

/**
 * The changelog address for the docs sidebar and the dashboard sidebar, or null
 * when there is nothing to link to.
 *
 * The changelog is a marketing page, and a self-hosted install serves no
 * marketing site — so /changelog 404s there and the link must not render. The
 * docs themselves are deliberately *not* gated: documentation is useful to
 * whoever is running the thing. Only this one link disappears, and the gate
 * lives here rather than in app/docs/layout.tsx so that file keeps saying
 * nothing about the marketing flag. tests/unit/marketing-surface-gate.test.ts
 * asserts exactly that, and the point of the assertion is that a future
 * refactor cannot quietly make the whole docs tree conditional.
 *
 * Absolute on a split-host deployment, where the marketing site and the app
 * answer on different origins and a relative /changelog would be served by
 * the app, which has no such route.
 */
export function resolveChangelogUrl(): string | null {
  if (!marketingSiteEnabled()) return null
  return `${MARKETING_URL}/changelog`
}
