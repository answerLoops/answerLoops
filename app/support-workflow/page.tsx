import type { Metadata } from 'next'
import { ProofPage } from '@/components/marketing/proof-page'
import { resolveNavState } from '@/lib/marketing/nav-state'
import { WorkflowDiagram } from '@/components/marketing/workflow-diagram'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Set the rules for automated replies | AnswerLoops',
  description:
    'Start with drafts your team reviews. Enable automatic replies for a channel after testing your knowledge sources and confidence threshold.',
  alternates: { canonical: '/support-workflow' },
}

export default async function SupportWorkflowPage() {
  return (
    <ProofPage
      navState={await resolveNavState()}
      eyebrow="Support workflow"
      title="Set the rules for automated replies"
      intro="Start with drafts your team reviews. Enable automatic replies for a channel after testing your knowledge sources and confidence threshold."
      sections={[
        {
          title: '1. Connect a channel',
          body: 'Select the conversations AnswerLoops should receive.',
          details: [
            'Incoming questions appear in the shared ticket queue.',
            'Each ticket retains its source.',
            'Use category and priority to organize the work.',
          ],
        },
        {
          title: '2. Inspect the draft',
          body: 'Check the proposed answer against the question and the supporting documentation.',
          details: [
            'Correct outdated or incomplete source articles.',
            'Check whether the answer addresses the actual question.',
            'Edit the draft before sending when necessary.',
          ],
        },
        {
          title: '3. Enable automatic replies',
          body: 'Turn on automatic replies for the channels you are ready to automate.',
          details: [
            'The separate AI review must meet your confidence threshold.',
            'A confidence score is a model assessment, not a guarantee of correctness.',
            'Questions that do not qualify remain in the team queue.',
          ],
        },
        {
          title: '4. Review resolved tickets',
          body: 'Save answers that will help with future questions.',
          details: [
            'Promote useful resolutions to the knowledge base.',
            'Keep one-off customer details out of general articles.',
            'Review answer feedback and update the underlying sources.',
          ],
        },
      ]}
      docs={[
        {
          label: 'AI configuration',
          href: '/docs/product/ai-deflection',
        },
        {
          label: 'Tickets',
          href: '/docs/product/tickets',
        },
        {
          label: 'Knowledge base',
          href: '/docs/product/knowledge-base',
        },
      ]}
      schema={{
        name: 'Set the rules for automated replies',
        description:
          'Start with drafts your team reviews. Enable automatic replies for a channel after testing your knowledge sources and confidence threshold.',
        path: '/support-workflow',
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
