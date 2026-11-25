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
    'Keep your Circle community. New posts and comments become tickets with AI-drafted, AI-reviewed answers from your own knowledge base, ready for your team to post in Circle.',
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
      title="Keep Circle members learning and participating"
      intro="Every new question in Circle arrives with an answer drafted from your course materials and guides. Your team reviews it and posts the answer in Circle, so members always hear from you."
      audience="Circle community operators and course creators who want AI answers without moving members to a new platform."
      highlights={[
        {
          title: 'Keep your community as-is',
          body: 'answerLoops connects through Circle Workflows — no migration, no new platform for your members to learn.',
        },
        {
          title: 'Help members get back to learning',
          body: 'Connect your course materials, documentation, and past resolutions so replies are grounded in what you actually maintain.',
        },
        {
          title: 'Check replies against your course materials',
          body: 'A separate review agent checks each draft against its sources and assigns a confidence score. Low-confidence drafts are flagged, and nothing is posted to Circle without your team.',
        },
        {
          title: 'Follow up on questions that need your team',
          body: 'Circle tickets sit in the same queue as Discord, Slack, Discourse, and every other connected channel — one place to review what needs a person.',
        },
      ]}
      workflow={[
        {
          step: '01',
          title: 'Connect Circle Workflows',
          body: 'Set up one webhook Workflow for new posts and one for new comments, add an Admin API token, then choose which spaces to watch.',
        },
        {
          step: '02',
          title: 'Review each draft',
          body: 'Each question lands in your ticket queue with a drafted answer and a confidence score from the review agent.',
        },
        {
          step: '03',
          title: 'Answer in Circle',
          body: 'Edit the draft if needed and post it in Circle yourself. Low-confidence drafts are flagged for a closer look.',
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
        {
          label: 'Answering Circle questions without living in the app',
          href: '/blog/circle-community-support',
        },
      ]}
      schema={{
        name: 'Add AI-reviewed answers to your Circle community',
        description:
          'Keep your Circle community. New posts and comments become tickets with AI-drafted, AI-reviewed answers from your own knowledge base, ready for your team to post in Circle.',
        path: '/circle-ai-answers',
      }}
    />
  )
}
