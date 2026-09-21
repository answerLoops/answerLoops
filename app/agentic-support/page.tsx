import { publicPageMetadata } from '@/lib/marketing/metadata'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ProofPage } from '@/components/marketing/proof-page'
import { resolveNavState } from '@/lib/marketing/nav-state'
import { WorkflowDiagram } from '@/components/marketing/workflow-diagram'
import { marketingSiteEnabled } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = publicPageMetadata({
  title: 'AI support replies with source review | answerLoops',
  description:
    'The answer agent retrieves your documentation and drafts a reply. The review agent checks that draft against its sources. Your channel settings decide whether a qualifying answer is sent or held for your team.',
  path: '/agentic-support',
})

export default async function AgenticSupportPage() {
  // Not served by a self-hosted install: there is no hosted plan to sell there,
  // and the page would be advertising our pricing from somebody else's domain.
  if (!marketingSiteEnabled()) notFound()

  return (
    <ProofPage
      navState={await resolveNavState()}
      eyebrow="Answer preparation"
      title="How answerLoops drafts and checks a reply"
      intro="The answer agent retrieves your documentation and drafts a reply. The review agent checks that draft against its sources. Your channel settings decide whether a qualifying answer is sent or held for your team."
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
          body: 'The review agent compares the draft with the available evidence.',
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
        name: 'How answerLoops drafts and checks a reply',
        description:
          'The answer agent retrieves your documentation and drafts a reply. The review agent checks that draft against its sources. Your channel settings decide whether a qualifying answer is sent or held for your team.',
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
