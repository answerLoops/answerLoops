import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ComparisonPage } from '@/components/marketing/comparison-page'
import { marketingSiteEnabled } from '@/lib/site'

export const metadata: Metadata = {
  title: 'answerLoops vs Chatbase',
  description:
    'Chatbase now covers more than a website widget. Compare its customer-service channels and agent configuration with answerLoops’ community ticket workflow and self-hosting option.',
  alternates: { canonical: '/vs/chatbase' },
}
export default function Page() {
  // Not served by a self-hosted install: there is no hosted plan to sell there,
  // and the page would be advertising our pricing from somebody else's domain.
  if (!marketingSiteEnabled()) notFound()

  return (
    <ComparisonPage
      competitor="Chatbase"
      slug="chatbase"
      source="https://www.chatbase.co/"
      competitorSummary="Chatbase offers AI agents for chat, email, and voice, with a helpdesk for AI and human conversations."
      intro="Chatbase now covers more than a website widget. Compare its customer-service channels and agent configuration with answerLoops’ community ticket workflow and self-hosting option."
      rows={[
        {
          feature: 'Channels',
          us: 'Discord, Slack, Discourse, Circle, GitHub, Telegram, email, Google Chat, and a website widget.',
          them: 'Chat, email, voice, Slack, and other connected messaging channels.',
        },
        {
          feature: 'Answer workflow',
          us: 'An answer agent drafts from workspace knowledge, a review agent checks it, and automatic replies go out when enabled and above the configured threshold.',
          them: 'Configurable agent instructions, procedures, actions, and a shared AI/human helpdesk.',
        },
        {
          feature: 'Knowledge',
          us: 'Import files, URLs, GitHub content, and Notion pages; promote useful ticket resolutions.',
          them: 'Connected data sources supply agent context; a playground supports testing.',
        },
      ]}
      bestFor={{
        us: 'You want documentation-based answers across community channels, control over automatic replies, and the option to operate the AGPL-3.0 application yourself.',
        them: 'You need chat, email, and voice agents with configured procedures and customer actions.',
      }}
    />
  )
}
