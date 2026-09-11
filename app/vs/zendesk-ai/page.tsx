import type { Metadata } from 'next'
import { ComparisonPage } from '@/components/marketing/comparison-page'
export const metadata: Metadata = {
  title: 'AnswerLoops vs Zendesk AI',
  description:
    'Compare the scope of the support platform and the total operating cost. Zendesk combines agent seats, plan allowances, and optional add-ons; AnswerLoops combines a hosted answer allowance with separate model costs, or can be self-hosted.',
  alternates: { canonical: '/vs/zendesk-ai' },
}
export default function Page() {
  return (
    <ComparisonPage
      competitor="Zendesk AI"
      slug="zendesk-ai"
      source="https://www.zendesk.com/pricing/"
      competitorSummary="Zendesk offers a support suite with ticketing, AI agents, and additional products for support operations."
      intro="Compare the scope of the support platform and the total operating cost. Zendesk combines agent seats, plan allowances, and optional add-ons; AnswerLoops combines a hosted answer allowance with separate model costs, or can be self-hosted."
      rows={[
        {
          feature: 'Platform',
          us: 'Community questions and a shared ticket queue, with documentation-based drafts and AI review.',
          them: 'A customer-service suite with ticketing, AI agents, and additional support-operations products.',
        },
        {
          feature: 'Hosted billing',
          us: 'Monthly or annual plan; automated-answer allowances vary by tier. Model usage is billed separately.',
          them: 'Agent seats, selected add-ons, and AI resolutions beyond the plan allowance contribute to cost.',
        },
        {
          feature: 'Integrations',
          us: 'Community channel integrations, MCP, and a REST API.',
          them: 'Marketplace integrations and APIs for custom workflows.',
        },
      ]}
      bestFor={{
        us: 'You want documentation-based answers across community channels, control over automatic replies, and the option to operate the AGPL-3.0 application yourself.',
        them: 'You need the broader Zendesk suite and want to evaluate its AI agents alongside existing support operations.',
      }}
    />
  )
}
