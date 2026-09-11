import type { Metadata } from 'next'
import { IntentPage } from '@/components/marketing/intent-page'
import { resolveNavState } from '@/lib/marketing/nav-state'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Answer support questions in Discord and GitHub | answerLoops',
  description:
    'Receive Discord conversations and GitHub Issues or Discussions in one ticket queue. Draft replies from the documentation and knowledge your team maintains.',
  alternates: { canonical: '/discord-github-support' },
}
export default async function Page() {
  return (
    <IntentPage
      navState={await resolveNavState()}
      eyebrow="Use case"
      title="Answer support questions in Discord and GitHub"
      intro="Receive Discord conversations and GitHub Issues or Discussions in one ticket queue. Draft replies from the documentation and knowledge your team maintains."
      audience="Maintainers and developer-support teams that handle questions in both community chat and GitHub."
      highlights={[
        {
          title: 'Share the same sources',
          body: 'Connect your documentation and repository knowledge so both channels draw from the same material.',
        },
        {
          title: 'Reply where the question started',
          body: 'Send the answer to the original Discord conversation or GitHub thread.',
        },
        {
          title: 'Review uncertain answers',
          body: 'Check and edit drafts that do not qualify for automatic replies.',
        },
        {
          title: 'Reuse reviewed resolutions',
          body: 'Promote useful ticket answers into the knowledge base for future questions.',
        },
      ]}
      workflow={[
        {
          step: '01',
          title: 'Connect both channels',
          body: 'Configure Discord and GitHub, then choose the conversations and repositories to monitor.',
        },
        {
          step: '02',
          title: 'Test the answers',
          body: 'Ask representative questions and review the drafts against your documentation.',
        },
        {
          step: '03',
          title: 'Choose reply settings',
          body: 'Enable automatic replies where appropriate. Other drafts stay in the team queue.',
        },
      ]}
      comparison={[
        {
          question: 'Can I use automatic replies?',
          answer:
            'Yes. Enable them per channel and configure the confidence threshold in the channel settings. They are off by default.',
        },
        {
          question: 'Can I add other channels?',
          answer:
            'Yes. Slack, Discourse, Circle, Telegram, email, Google Chat, and the website widget use the same workspace knowledge.',
        },
      ]}
      docs={[
        {
          label: 'Discord setup',
          href: '/docs/integrations/discord',
        },
        {
          label: 'GitHub setup',
          href: '/docs/integrations/github',
        },
      ]}
      schema={{
        name: 'Answer support questions in Discord and GitHub',
        description:
          'Receive Discord conversations and GitHub Issues or Discussions in one ticket queue. Draft replies from the documentation and knowledge your team maintains.',
        path: '/discord-github-support',
      }}
    />
  )
}
