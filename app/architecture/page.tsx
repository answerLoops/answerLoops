import type { Metadata } from 'next'
import { ProofPage } from '@/components/marketing/proof-page'
import { resolveNavState } from '@/lib/marketing/nav-state'
import { WorkflowDiagram } from '@/components/marketing/workflow-diagram'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'How a question becomes a reviewed answer | answerLoops',
  description:
    'answerLoops records the question, retrieves relevant knowledge, drafts a reply, and runs a separate AI review. Channel settings determine whether the reply posts automatically or waits for your team.',
  alternates: { canonical: '/architecture' },
}

export default async function ArchitecturePage() {
  return (
    <ProofPage
      navState={await resolveNavState()}
      eyebrow="Architecture"
      title="How a question becomes a reviewed answer"
      intro="answerLoops records the question, retrieves relevant knowledge, drafts a reply, and runs a separate AI review. Channel settings determine whether the reply posts automatically or waits for your team."
      sections={[
        {
          title: 'Keep the conversation attached',
          body: 'Questions from connected channels become tickets in the same workspace.',
          details: [
            'The ticket identifies the source channel.',
            'Category and priority help your team sort the queue.',
            'Replies return to the conversation where the question started.',
          ],
        },
        {
          title: 'Retrieve relevant knowledge',
          body: 'The drafting step searches the knowledge available to the request.',
          details: [
            'Import documentation, files, GitHub content, and Notion pages.',
            'Add reviewed resolutions to the knowledge base.',
            'The public widget searches published knowledge.',
          ],
        },
        {
          title: 'Review before sending',
          body: 'A second AI pass checks the draft against the retrieved sources and assigns a confidence score.',
          details: [
            'Automatic replies must be enabled for the channel.',
            'The score must meet the configured threshold.',
            'Other drafts remain available for your team to review.',
          ],
        },
        {
          title: 'Maintain the source material',
          body: 'Your team decides which resolved answers should be reusable.',
          details: [
            'Review the explanation before promoting it to knowledge.',
            'Update articles when product behavior changes.',
            'Use knowledge-gap reports on Pro and Enterprise to identify missing documentation.',
          ],
        },
      ]}
      docs={[
        {
          label: 'Answer review settings',
          href: '/docs/product/ai-deflection',
        },
        {
          label: 'Knowledge base',
          href: '/docs/product/knowledge-base',
        },
        {
          label: 'Agent access',
          href: '/docs/integrations/mcp',
        },
      ]}
      schema={{
        name: 'How a question becomes a reviewed answer',
        description:
          'answerLoops records the question, retrieves relevant knowledge, drafts a reply, and runs a separate AI review. Channel settings determine whether the reply posts automatically or waits for your team.',
        path: '/architecture',
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
