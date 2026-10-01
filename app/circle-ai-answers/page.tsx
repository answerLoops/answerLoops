import { publicPageMetadata } from '@/lib/marketing/metadata'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { IntentPage } from '@/components/marketing/intent-page'
import { resolveNavState } from '@/lib/marketing/nav-state'
import { marketingSiteEnabled } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = publicPageMetadata({
  title: 'AI-reviewed answers for your Circle community | answerLoops',
  description:
    'Keep your Circle community. Add AI-drafted, AI-reviewed answers to new posts and comments from your own knowledge base, with automatic replies you control.',
  path: '/circle-ai-answers',
})
export default async function Page() {
  // Not served by a self-hosted install: there is no hosted plan to sell there,
  // and the page would be advertising our pricing from somebody else's domain.
  if (!marketingSiteEnabled()) notFound()

  return (
    <IntentPage
      navState={await resolveNavState()}
      eyebrow="Integration"
      title="Add AI-reviewed answers to your Circle community"
      intro="answerLoops connects to the Circle community you already run through Circle Workflows — it doesn't replace it. New posts and comments are drafted from your knowledge base, checked by a separate review agent, and sent automatically once you trust the pattern."
      audience="Circle community operators and course creators who want AI answers without moving members to a new platform."
      highlights={[
        {
          title: 'Keep your community as-is',
          body: 'answerLoops connects through Circle Workflows — no migration, no new platform for your members to learn.',
        },
        {
          title: 'Answers drafted from your knowledge base',
          body: 'Connect your course materials, documentation, and past resolutions so replies are grounded in what you actually maintain.',
        },
        {
          title: 'A second agent checks every draft',
          body: 'A separate review agent checks each draft against its sources and assigns a confidence score before anything posts automatically — off by default, so nothing goes out unreviewed until you trust it.',
        },
        {
          title: 'One queue across every channel',
          body: 'Circle tickets sit in the same queue as Discord, Slack, Discourse, and every other connected channel — one place to review what needs a person.',
        },
      ]}
      workflow={[
        {
          step: '01',
          title: 'Connect Circle Workflows',
          body: 'Set up a webhook workflow for new posts and comments, plus an Admin API token, then choose which spaces to watch.',
        },
        {
          step: '02',
          title: 'Review a batch of drafts',
          body: 'Watch how the review agent scores real questions from your community before enabling automatic replies.',
        },
        {
          step: '03',
          title: 'Turn on automatic replies',
          body: 'Enable it once you trust the pattern — lower-confidence drafts still wait in your ticket queue.',
        },
      ]}
      comparison={[
        {
          question: 'Does this replace Circle?',
          answer:
            'No. answerLoops connects to the Circle community you already run and adds AI-drafted, AI-reviewed answers — it isn’t a new community platform to migrate to.',
        },
        {
          question: 'Does answerLoops use the same review process here as Discord or Slack?',
          answer:
            'Yes. Every channel, including Circle, goes through the same drafting and dual-agent review pipeline — a separate agent checks each draft against its sources before a confidence score is assigned.',
        },
        {
          question: 'Can I connect Circle alongside other channels?',
          answer:
            'Yes. Discord, Slack, Discourse, GitHub, Telegram, email, Google Chat, and the website widget all use the same workspace knowledge and the same ticket queue.',
        },
      ]}
      docs={[
        {
          label: 'Circle setup',
          href: '/docs/integrations/circle',
        },
        {
          label: 'How dual-agent review works',
          href: '/dual-agent-ai-support',
        },
      ]}
      schema={{
        name: 'Add AI-reviewed answers to your Circle community',
        description:
          'Keep your Circle community. Add AI-drafted, AI-reviewed answers to new posts and comments from your own knowledge base, with automatic replies you control.',
        path: '/circle-ai-answers',
      }}
    />
  )
}
