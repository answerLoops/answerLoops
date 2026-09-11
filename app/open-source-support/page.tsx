import type { Metadata } from 'next'
import { IntentPage } from '@/components/marketing/intent-page'
import { resolveNavState } from '@/lib/marketing/nav-state'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Support your project across community channels | answerLoops',
  description:
    'Collect questions from Discord, GitHub, forums, and other connected channels. Prepare answers from your project documentation and keep requests that need maintainer judgment in the ticket queue.',
  alternates: { canonical: '/open-source-support' },
}
export default async function Page() {
  return (
    <IntentPage
      navState={await resolveNavState()}
      eyebrow="Use case"
      title="Support your project across community channels"
      intro="Collect questions from Discord, GitHub, forums, and other connected channels. Prepare answers from your project documentation and keep requests that need maintainer judgment in the ticket queue."
      audience="Open-source maintainers and developer-relations teams managing documentation, community questions, and issue triage."
      highlights={[
        {
          title: 'Use your project documentation',
          body: 'Import URLs, files, repository content, and Notion pages into the knowledge base.',
        },
        {
          title: 'Keep the original context',
          body: 'Tickets identify the source channel so the team can follow the conversation.',
        },
        {
          title: 'Choose what to automate',
          body: 'Enable automatic replies per channel after reviewing representative drafts.',
        },
        {
          title: 'Run the source yourself',
          body: 'answerLoops is available under AGPL-3.0, with a documented self-hosting setup.',
        },
      ]}
      workflow={[
        {
          step: '01',
          title: 'Add your sources',
          body: 'Start with current setup guides, troubleshooting articles, and FAQs.',
        },
        {
          step: '02',
          title: 'Connect the community',
          body: 'Choose the channels and repositories where you want answerLoops to receive questions.',
        },
        {
          step: '03',
          title: 'Maintain the answers',
          body: 'Review unresolved tickets and promote reusable resolutions into knowledge.',
        },
      ]}
      comparison={[
        {
          question: 'Is self-hosting free?',
          answer:
            'There is no answerLoops subscription fee for the AGPL-3.0 self-hosted edition. You pay for infrastructure and any model services you use.',
        },
        {
          question: 'What stays with maintainers?',
          answer:
            'Your team reviews drafts that do not qualify for automatic replies and handles decisions that require project-specific judgment.',
        },
      ]}
      docs={[
        {
          label: 'Self-host quickstart',
          href: '/docs/quickstart-self-host',
        },
        {
          label: 'Hosted plans',
          href: '/pricing',
        },
      ]}
      schema={{
        name: 'Support your project across community channels',
        description:
          'Collect questions from Discord, GitHub, forums, and other connected channels. Prepare answers from your project documentation and keep requests that need maintainer judgment in the ticket queue.',
        path: '/open-source-support',
      }}
    />
  )
}
