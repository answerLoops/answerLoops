import { publicPageMetadata } from '@/lib/marketing/metadata'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ComparisonPage } from '@/components/marketing/comparison-page'
import { marketingSiteEnabled } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = publicPageMetadata({
  title: 'answerLoops vs Kapa.ai',
  description:
    'Kapa.ai is a hosted answer bot for technical documentation, built for Discord, Slack, and a website widget. Compare that to an AI layer covering nine channels including Telegram, Discourse, Circle, and email, with a self-hosted option.',
  path: '/vs/kapa-ai',
})
export default function Page() {
  // Not served by a self-hosted install: there is no hosted plan to sell there,
  // and the page would be advertising our pricing from somebody else's domain.
  if (!marketingSiteEnabled()) notFound()

  return (
    <ComparisonPage
      competitor="Kapa.ai"
      slug="kapa-ai"
      source="https://docs.kapa.ai/overview/showcase"
      competitorSummary="Kapa.ai is a hosted answer bot built for technical documentation — it ingests 40+ source types and answers in Discord, Slack, and an embeddable website widget."
      intro="Kapa.ai is a hosted answer bot for technical documentation, built for Discord, Slack, and a website widget. Compare that to an AI layer covering nine channels including Telegram, Discourse, Circle, and email, with a self-hosted option."
      rows={[
        {
          feature: 'Channels',
          us: 'Discord, Slack, Discourse, Circle, GitHub, Telegram, email, Google Chat, and a website widget.',
          them: 'Discord, Slack, and an embeddable website widget, plus an MCP server and API — no Telegram, Discourse, Circle, or email channel.',
        },
        {
          feature: 'Answer workflow',
          us: 'An answer agent drafts from your workspace knowledge, a separate review agent checks it against the retrieved sources, and automatic replies go out when enabled and above the configured confidence threshold.',
          them: 'Kapa auto-replies to mentions and, in forum channels, to new posts, grounded in ingested documentation and community sources.',
        },
        {
          feature: 'Deployment and pricing',
          us: 'Published per-plan pricing on managed plans, or an AGPL-3.0 self-hosted deployment you operate yourself.',
          them: 'Sales-quote pricing metered by answers, retrieval queries, and pages crawled, with a 14-day trial; no public self-hosted option.',
        },
      ]}
      bestFor={{
        us: 'You need Telegram, Discourse, Circle, or email alongside Discord and Slack, want published pricing, or need to self-host.',
        them: 'You’re a developer-tool company that wants a docs-focused answer bot with deep ingestion across 40+ technical source types and doesn’t need self-hosting or channels beyond Discord, Slack, and the web.',
      }}
    />
  )
}
