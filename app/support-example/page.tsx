import type { Metadata } from 'next'
import { ProofPage } from '@/components/marketing/proof-page'
import { resolveNavState } from '@/lib/marketing/nav-state'
import { AnimatedChat } from '@/components/animated-chat'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Inspect a question, source, draft, and review | AnswerLoops',
  description:
    'This illustrative example follows a workspace invitation question. Select each step to see the information used to prepare the reply.',
  alternates: { canonical: '/support-example' },
}

export default async function SupportExamplePage() {
  return (
    <ProofPage
      navState={await resolveNavState()}
      eyebrow="Support example"
      title="Inspect a question, source, draft, and review"
      intro="This illustrative example follows a workspace invitation question. Select each step to see the information used to prepare the reply."
      sections={[
        {
          title: 'What the draft uses',
          body: 'The source describes who can invite a teammate and where to send the invitation.',
          details: [
            'The answer names the Settings → Team screen.',
            'It includes the email and role fields.',
            'It links to the team documentation.',
          ],
        },
        {
          title: 'What decides whether it posts',
          body: 'A separate AI review checks the draft. The channel’s reply settings determine the next action.',
          details: [
            'Automatic replies are off by default.',
            'Enabled channels require a score above the configured threshold.',
            'Your team can review and edit drafts in the ticket queue.',
          ],
        },
      ]}
      docs={[
        {
          label: 'Team guide',
          href: '/docs/product/team',
        },
        {
          label: 'Reply settings',
          href: '/docs/product/ai-deflection',
        },
        {
          label: 'Full workflow',
          href: '/support-workflow',
        },
      ]}
      schema={{
        name: 'Inspect a question, source, draft, and review',
        description:
          'This illustrative example follows a workspace invitation question. Select each step to see the information used to prepare the reply.',
        path: '/support-example',
      }}
    >
      <section className="marketing-section marketing-soft">
        <div className="marketing-container">
          <div className="mx-auto max-w-2xl">
            <AnimatedChat />
          </div>
        </div>
      </section>
    </ProofPage>
  )
}
