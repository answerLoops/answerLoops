import type { Metadata } from 'next'
import { ComparisonPage } from '@/components/marketing/comparison-page'
export const metadata: Metadata = {
  title: 'answerLoops vs Pylon',
  description:
    'Pylon supports Discord, Telegram, and MCP as well as Slack and Teams. Compare the customer context and operational controls your team needs with answerLoops’ documentation-based workflow and self-hosting option.',
  alternates: { canonical: '/vs/pylon' },
}
export default function Page() {
  return (
    <ComparisonPage
      competitor="Pylon"
      slug="pylon"
      source="https://www.usepylon.com/"
      competitorSummary="Pylon combines B2B support with customer context, AI agents, and account and product intelligence."
      intro="Pylon supports Discord, Telegram, and MCP as well as Slack and Teams. Compare the customer context and operational controls your team needs with answerLoops’ documentation-based workflow and self-hosting option."
      rows={[
        {
          feature: 'Channels',
          us: 'Discord, Slack, Discourse, Circle, GitHub, Telegram, email, Google Chat, and a website widget.',
          them: 'Slack, Microsoft Teams, phone, email, WhatsApp, Telegram, and Discord.',
        },
        {
          feature: 'Answer workflow',
          us: 'A draft from workspace knowledge, a separate AI review, and automatic replies when enabled and above the configured threshold.',
          them: 'Support agents resolve requests across channels, with people handling questions that need judgment.',
        },
        {
          feature: 'Agent access',
          us: 'MCP and REST tools for searching knowledge, generating answers, and creating tickets.',
          them: 'MCP makes customer context available to agents and the team.',
        },
      ]}
      bestFor={{
        us: 'You want documentation-based answers across community channels, control over automatic replies, and the option to operate the AGPL-3.0 application yourself.',
        them: 'You want B2B support tied to CRM, product usage, account context, and several kinds of AI agents.',
      }}
    />
  )
}
