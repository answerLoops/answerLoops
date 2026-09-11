import type { Metadata } from 'next'
import { ComparisonPage } from '@/components/marketing/comparison-page'
export const metadata: Metadata = {
  title: 'AnswerLoops vs Chatbase',
  description:
    'Chatbase now covers more than a website widget. Compare its customer-service channels and agent configuration with AnswerLoops’ community ticket workflow and self-hosting option.',
  alternates: { canonical: '/vs/chatbase' },
}
export default function Page() {
  return (
    <ComparisonPage
      competitor="Chatbase"
      slug="chatbase"
      source="https://www.chatbase.co/"
      competitorSummary="Chatbase offers AI agents for chat, email, and voice, with a helpdesk for AI and human conversations."
      intro="Chatbase now covers more than a website widget. Compare its customer-service channels and agent configuration with AnswerLoops’ community ticket workflow and self-hosting option."
      rows={[
        {
          feature: 'Channels',
          us: 'Discord, Slack, Discourse, Circle, GitHub, Telegram, email, Google Chat, and a website widget.',
          them: 'Chat, email, voice, Slack, and other connected messaging channels.',
        },
        {
          feature: 'Answer workflow',
          us: 'A draft from workspace knowledge, a separate AI review, and automatic replies when enabled and above the configured threshold.',
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
