import { publicPageMetadata } from '@/lib/marketing/metadata'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ProofPage } from '@/components/marketing/proof-page'
import { resolveNavState } from '@/lib/marketing/nav-state'
import { AnimatedChat } from '@/components/animated-chat'
import { marketingSiteEnabled } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = publicPageMetadata({
  title: 'See how a support reply is prepared | answerLoops',
  description:
    'See how answerLoops handles questions from Discord, Telegram, and Circle. Choose a channel to follow the question, source documents, draft, and review.',
  path: '/support-example',
})

export default async function SupportExamplePage() {
  // Not served by a self-hosted install: there is no hosted plan to sell there,
  // and the page would be advertising our pricing from somebody else's domain.
  if (!marketingSiteEnabled()) notFound()

  return (
    <ProofPage
      navState={await resolveNavState()}
      eyebrow="Support example"
      title="See how a support reply is prepared"
      intro="See how answerLoops handles questions from Discord, Telegram, and Circle. Choose a channel to follow the question, source documents, draft, and review."
      sections={[
        {
          title: 'What the draft uses',
          body: 'Each example includes a question and two sample documents that provide the information for the reply.',
          details: [
            'Discord shows a developer asking about duplicate webhook events.',
            'Telegram shows a new guild member preparing for a weekend raid.',
            'Circle shows an artist preparing work for a community print swap.',
          ],
        },
        {
          title: 'What decides whether it posts',
          body: 'A review agent checks the draft. The channel’s reply settings determine the next action.',
          details: [
            'Automatic replies are off by default.',
            'Enabled channels require a score above the configured threshold.',
            'Your team can review and edit drafts in the ticket queue.',
          ],
        },
      ]}
      docs={[
        {
          label: 'Knowledge source guide',
          href: '/docs/product/knowledge-base',
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
        name: 'See how a support reply is prepared',
        description:
          'See how answerLoops handles questions from Discord, Telegram, and Circle. Choose a channel to follow the question, source documents, draft, and review.',
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
