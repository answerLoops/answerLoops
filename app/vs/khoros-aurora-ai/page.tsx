import { publicPageMetadata } from '@/lib/marketing/metadata'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ComparisonPage } from '@/components/marketing/comparison-page'
import { marketingSiteEnabled } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = publicPageMetadata({
  title: 'answerLoops vs Khoros Aurora AI',
  description:
    'Khoros Aurora AI layers grounded answers, moderation, and workflow automation onto the Khoros enterprise community platform. Compare that to an AI layer that connects to the chat platforms your community already uses.',
  path: '/vs/khoros-aurora-ai',
})
export default function Page() {
  // Not served by a self-hosted install: there is no hosted plan to sell there,
  // and the page would be advertising our pricing from somebody else's domain.
  if (!marketingSiteEnabled()) notFound()

  return (
    <ComparisonPage
      competitor="Khoros Aurora AI"
      slug="khoros-aurora-ai"
      source="https://khoros.ai/aurora/"
      competitorSummary="Aurora AI is Khoros's AI layer for its enterprise community platform — grounded, cited answers alongside AI moderation and workflow automation, built for forums, knowledge base, ideas, events, and groups."
      intro="Khoros Aurora AI layers grounded answers, moderation, and workflow automation onto the Khoros enterprise community platform. Compare that to an AI layer that connects to the chat platforms your community already uses."
      rows={[
        {
          feature: 'Where it runs',
          us: 'Discord, Slack, Discourse, Circle, GitHub, Telegram, email, Google Chat, and a website widget — connects to the platforms your community already uses.',
          them: 'Aurora AI runs inside the Khoros community platform itself (forums, knowledge base, ideas, events, groups) — it is part of that platform, not a layer you add to an existing Discord or Slack community.',
        },
        {
          feature: 'Answer workflow',
          us: 'An answer agent drafts from your workspace knowledge, a separate review agent checks it against the retrieved sources, and automatic replies go out when enabled and above the configured confidence threshold.',
          them: 'Aurora AI’s Answer Assist provides grounded, cited answers when human experts have not already responded, alongside AI Moderation and Orchestrator-driven workflow automation.',
        },
        {
          feature: 'Deployment and pricing',
          us: 'Published per-plan pricing on managed plans, or an AGPL-3.0 self-hosted deployment you operate yourself.',
          them: 'Enterprise sales-quote pricing on the Khoros platform; no public self-hosted option.',
        },
      ]}
      bestFor={{
        us: 'You want AI answers inside the chat platforms your community already lives in, transparent published pricing, or the option to self-host.',
        them: 'You already run, or are building, a large enterprise community platform with forums, ideas, and events, and want Khoros’s own AI layered directly into it.',
      }}
    />
  )
}
