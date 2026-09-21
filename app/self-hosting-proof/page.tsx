import { publicPageMetadata } from '@/lib/marketing/metadata'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ProofPage } from '@/components/marketing/proof-page'
import { resolveNavState } from '@/lib/marketing/nav-state'
import { marketingSiteEnabled } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = publicPageMetadata({
  title: 'Plan your answerLoops deployment | answerLoops',
  description:
    'Run the application and channel services on infrastructure you manage. Before launch, configure authentication, storage, model access, backups, and updates.',
  path: '/self-hosting-proof',
})

export default async function SelfHostingProofPage() {
  // Not served by a self-hosted install: there is no hosted plan to sell there,
  // and the page would be advertising our pricing from somebody else's domain.
  if (!marketingSiteEnabled()) notFound()

  return (
    <ProofPage
      navState={await resolveNavState()}
      eyebrow="Deployment checklist"
      title="Plan your answerLoops deployment"
      intro="Run the application and channel services on infrastructure you manage. Before launch, configure authentication, storage, model access, backups, and updates."
      sections={[
        {
          title: 'Prepare the application',
          body: 'Follow the Docker Compose quickstart and configure the required services.',
          details: [
            'Choose a domain and configure authentication.',
            'Connect the database and storage.',
            'Verify login and create your workspace.',
          ],
        },
        {
          title: 'Connect channels',
          body: 'Configure each platform your community uses.',
          details: [
            'Register the required channel apps or bots.',
            'Select the channels or repositories to monitor.',
            'Send a test question and confirm the reply destination.',
          ],
        },
        {
          title: 'Choose model and data services',
          body: 'Self-hosting controls where the application runs. Your connected services still determine where data is processed.',
          details: [
            'External model providers receive content needed to generate answers.',
            'Channel platforms continue to process messages.',
            'Review chat and embedding configuration separately.',
          ],
        },
        {
          title: 'Assign operational ownership',
          body: 'Your team maintains the deployment.',
          details: [
            'Schedule database and storage backups.',
            'Follow the upgrade and migration instructions.',
            'Monitor channel delivery and model-provider errors.',
          ],
        },
      ]}
      docs={[
        {
          label: 'Self-host quickstart',
          href: '/docs/quickstart-self-host',
        },
        {
          label: 'Production guide',
          href: '/docs/self-hosting/production',
        },
        {
          label: 'Upgrade guide',
          href: '/docs/self-hosting/upgrading',
        },
      ]}
      schema={{
        name: 'Plan your answerLoops deployment',
        description:
          'Run the application and channel services on infrastructure you manage. Before launch, configure authentication, storage, model access, backups, and updates.',
        path: '/self-hosting-proof',
      }}
    ></ProofPage>
  )
}
