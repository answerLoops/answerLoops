import type { Metadata } from 'next'
import { IntentPage } from '@/components/marketing/intent-page'
import { resolveNavState } from '@/lib/marketing/nav-state'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Run AnswerLoops on your infrastructure | AnswerLoops',
  description:
    'Deploy the application and channel services yourself. Choose your model configuration and take responsibility for database operations, backups, and updates.',
  alternates: { canonical: '/self-hosted-ai-support' },
}
export default async function Page() {
  return (
    <IntentPage
      navState={await resolveNavState()}
      eyebrow="Use case"
      title="Run AnswerLoops on your infrastructure"
      intro="Deploy the application and channel services yourself. Choose your model configuration and take responsibility for database operations, backups, and updates."
      audience="Teams that need control over deployment and are prepared to operate the services behind their support workflow."
      highlights={[
        {
          title: 'Deploy with Docker Compose',
          body: 'Follow the documented application, database, authentication, and channel setup.',
        },
        {
          title: 'Choose model services',
          body: 'Use a supported provider or configure a compatible endpoint, including a local chat model.',
        },
        {
          title: 'Understand data processing',
          body: 'External model and channel services still receive the content needed to perform their functions. Check chat and embedding configuration separately.',
        },
        {
          title: 'Keep the source available',
          body: 'Inspect and modify the AGPL-3.0 code in accordance with its license.',
        },
      ]}
      workflow={[
        {
          step: '01',
          title: 'Prepare the services',
          body: 'Follow the prerequisites and configure authentication, database access, and storage.',
        },
        {
          step: '02',
          title: 'Connect knowledge and channels',
          body: 'Import your support documentation and configure the channel integrations you need.',
        },
        {
          step: '03',
          title: 'Operate the deployment',
          body: 'Test replies, configure backups, and follow the production and upgrade guides.',
        },
      ]}
      comparison={[
        {
          question: 'Is there a subscription fee?',
          answer:
            'The self-hosted edition has no AnswerLoops subscription fee. Infrastructure and model-provider costs are your responsibility.',
        },
        {
          question: 'Does self-hosting keep all data local?',
          answer:
            'No. The application runs on your infrastructure, but external channel platforms and configured model services process relevant content. Review your service choices against your requirements.',
        },
      ]}
      docs={[
        {
          label: 'Self-host quickstart',
          href: '/docs/quickstart-self-host',
        },
        {
          label: 'Deployment checklist',
          href: '/self-hosting-proof',
        },
      ]}
      schema={{
        name: 'Run AnswerLoops on your infrastructure',
        description:
          'Deploy the application and channel services yourself. Choose your model configuration and take responsibility for database operations, backups, and updates.',
        path: '/self-hosted-ai-support',
      }}
    />
  )
}
