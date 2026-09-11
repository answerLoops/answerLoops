import type { Metadata } from 'next'
import { ComparisonPage } from '@/components/marketing/comparison-page'
export const metadata: Metadata = {
  title: 'answerLoops vs Intercom',
  description:
    'Intercom and answerLoops both offer AI answers and human follow-up. Compare the channels you need, the helpdesk you already use, and whether you want to operate the application yourself.',
  alternates: { canonical: '/vs/intercom' },
}
export default function Page() {
  return (
    <ComparisonPage
      competitor="Intercom"
      slug="intercom"
      source="https://fin.ai/"
      competitorSummary="Intercom combines a helpdesk with Fin, its AI customer agent. Fin also connects to other helpdesks."
      intro="Intercom and answerLoops both offer AI answers and human follow-up. Compare the channels you need, the helpdesk you already use, and whether you want to operate the application yourself."
      rows={[
        {
          feature: 'Channels',
          us: 'Discord, Slack, Discourse, Circle, GitHub, Telegram, email, Google Chat, and a website widget.',
          them: 'Fin lists chat, email, voice, Slack, and social channels.',
        },
        {
          feature: 'Answer workflow',
          us: 'A draft from workspace knowledge, a separate AI review, and automatic replies when enabled and above the configured threshold.',
          them: 'Fin answers customer questions and hands conversations to a human team with context.',
        },
        {
          feature: 'Deployment',
          us: 'Managed plans or an AGPL-3.0 self-hosted deployment. External model and channel services still process relevant content.',
          them: 'Fin is available with Intercom or connected to another helpdesk.',
        },
      ]}
      bestFor={{
        us: 'You want documentation-based answers across community channels, control over automatic replies, and the option to operate the AGPL-3.0 application yourself.',
        them: 'You need a helpdesk and AI customer agent together, or want to add Fin to an existing helpdesk.',
      }}
    />
  )
}
