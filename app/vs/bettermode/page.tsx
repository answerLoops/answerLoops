import { publicPageMetadata } from '@/lib/marketing/metadata'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ComparisonPage } from '@/components/marketing/comparison-page'
import { marketingSiteEnabled } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = publicPageMetadata({
  title: 'answerLoops vs Bettermode',
  description:
    'Bettermode is a hosted community platform with AI search available on its Growth plan and up. Compare that to an AI layer that connects to the chat platforms your community already uses.',
  path: '/vs/bettermode',
})
export default function Page() {
  // Not served by a self-hosted install: there is no hosted plan to sell there,
  // and the page would be advertising our pricing from somebody else's domain.
  if (!marketingSiteEnabled()) notFound()

  return (
    <ComparisonPage
      competitor="Bettermode"
      slug="bettermode"
      source="https://bettermode.com/pricing"
      competitorSummary="Bettermode is a hosted community platform — forums, groups, activity feeds, and gamification — with AI and federated search included from its Growth plan up."
      intro="Bettermode is a hosted community platform with AI search available on its Growth plan and up. Compare that to an AI layer that connects to the chat platforms your community already uses."
      rows={[
        {
          feature: 'Where it runs',
          us: 'Discord, Slack, Discourse, Circle, GitHub, Telegram, email, Google Chat, and a website widget — connects to the platforms your community already uses.',
          them: 'Bettermode is its own hosted community site (forums, groups, activity feed) — AI search lives inside that platform, not layered onto an existing Discord or Slack community.',
        },
        {
          feature: 'Answer workflow',
          us: 'An answer agent drafts from your workspace knowledge, a separate review agent checks it against the retrieved sources, and automatic replies go out when enabled and above the configured confidence threshold.',
          them: 'AI and federated search are available from the Growth plan and up, built into Bettermode’s own forum and discussion surfaces.',
        },
        {
          feature: 'Deployment and pricing',
          us: 'Published per-plan pricing on managed plans, or an AGPL-3.0 self-hosted deployment you operate yourself.',
          them: 'Starter at $399/month, Growth at $1,500/month, Premium on request — Bettermode discontinued its free plan in March 2026.',
        },
      ]}
      bestFor={{
        us: 'You want AI answers inside the chat platforms your community already lives in, transparent published pricing at every tier, or the option to self-host.',
        them: 'You’re building a new branded community site from scratch — forums, groups, gamification — and want AI search once you’re on the Growth plan or above.',
      }}
    />
  )
}
