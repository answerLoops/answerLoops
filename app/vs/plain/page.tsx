import type { Metadata } from 'next'
import { ComparisonPage } from '@/components/marketing/comparison-page'
export const metadata: Metadata = {
  title: 'answerLoops vs Plain',
  description:
    'Both products support community channels and AI-assisted support. Evaluate the workflow and deployment requirements rather than assuming Plain is limited to Slack or human-written replies.',
  alternates: { canonical: '/vs/plain' },
}
export default function Page() {
  return (
    <ComparisonPage
      competitor="Plain"
      slug="plain"
      source="https://www.plain.com/"
      competitorSummary="Plain offers a B2B support workspace, AI assistants and agents, workflows, and APIs."
      intro="Both products support community channels and AI-assisted support. Evaluate the workflow and deployment requirements rather than assuming Plain is limited to Slack or human-written replies."
      rows={[
        {
          feature: 'Channels',
          us: 'Discord, Slack, Discourse, Circle, GitHub, Telegram, email, Google Chat, and a website widget.',
          them: 'Slack, Microsoft Teams, Discord, email, chat, and a customer portal.',
        },
        {
          feature: 'Answer workflow',
          us: 'A draft from workspace knowledge, a separate AI review, and automatic replies when enabled and above the configured threshold.',
          them: 'AI assistants and multiple agents work alongside people, with configurable workflows.',
        },
        {
          feature: 'Knowledge',
          us: 'Shared knowledge from imported sources and promoted resolutions.',
          them: 'Connected knowledge and a knowledge base built from support conversations.',
        },
      ]}
      bestFor={{
        us: 'You want documentation-based answers across community channels, control over automatic replies, and the option to operate the AGPL-3.0 application yourself.',
        them: 'You want a B2B support workspace with multiple AI agents, workflow automation, and an extensible API.',
      }}
    />
  )
}
