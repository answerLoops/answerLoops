import type { Metadata } from 'next'
import { ProofPage } from '@/components/marketing/proof-page'
import { resolveNavState } from '@/lib/marketing/nav-state'
import { WorkflowDiagram } from '@/components/marketing/workflow-diagram'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'AI drafts the answer. Your settings control the reply. | AnswerLoops',
  description:
    'AnswerLoops uses two AI steps: one drafts a response from your knowledge base, and another reviews it. Your team chooses which channels can send qualifying answers automatically.',
  alternates: { canonical: '/agentic-support' },
}

export default async function AgenticSupportPage() {
  return (
    <ProofPage
      navState={await resolveNavState()}
      eyebrow="Agentic support"
      title="AI drafts the answer. Your settings control the reply."
      intro="AnswerLoops uses two AI steps: one drafts a response from your knowledge base, and another reviews it. Your team chooses which channels can send qualifying answers automatically."
      sections={[
        {
          title: 'Draft from your documentation',
          body: 'Import the material your team uses to answer support questions.',
          details: [
            'Connect documents, URLs, GitHub content, and Notion pages.',
            'Search the same workspace knowledge across channels.',
            'Review and update the sources as your product changes.',
          ],
        },
        {
          title: 'Check the proposed answer',
          body: 'A separate review compares the draft with the available evidence.',
          details: [
            'Configure a confidence threshold in the channel settings.',
            'Test representative questions before enabling automation.',
            'Keep questions needing judgment in the team queue.',
          ],
        },
        {
          title: 'Reply in the original conversation',
          body: 'Connect Discord, Slack, Discourse, Circle, GitHub, Telegram, email, Google Chat, and your website widget.',
          details: [
            'See incoming tickets in one queue.',
            'Enable automatic replies per channel.',
            'Review drafts when automatic replies are disabled or the score is too low.',
          ],
        },
        {
          title: 'Connect your own agents',
          body: 'Use MCP or the REST API to search knowledge, generate answers, and create tickets.',
          details: [
            'Choose the permissions for each API key.',
            'Use the same workspace knowledge as channel support.',
            'Follow the integration guide for client setup.',
          ],
        },
      ]}
      docs={[
        {
          label: 'See an example',
          href: '/support-example',
        },
        {
          label: 'Configure answer review',
          href: '/docs/product/ai-deflection',
        },
        {
          label: 'Connect an agent',
          href: '/docs/integrations/mcp',
        },
      ]}
      schema={{
        name: 'AI drafts the answer. Your settings control the reply.',
        description:
          'AnswerLoops uses two AI steps: one drafts a response from your knowledge base, and another reviews it. Your team chooses which channels can send qualifying answers automatically.',
        path: '/agentic-support',
      }}
    >
      <section className="marketing-section marketing-soft">
        <div className="marketing-container">
          <WorkflowDiagram />
        </div>
      </section>
    </ProofPage>
  )
}
