import { publicPageMetadata } from '@/lib/marketing/metadata'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { IntentPage } from '@/components/marketing/intent-page'
import { resolveNavState } from '@/lib/marketing/nav-state'
import { marketingSiteEnabled } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = publicPageMetadata({
  title: 'AI-reviewed answers for your Discourse forum | answerLoops',
  description:
    'Keep your Discourse forum. Add AI-drafted, AI-reviewed answers to new topics and posts from your own documentation, with automatic replies you control.',
  path: '/discourse-ai-answers',
})
export default async function Page() {
  // Not served by a self-hosted install: there is no hosted plan to sell there,
  // and the page would be advertising our pricing from somebody else's domain.
  if (!marketingSiteEnabled()) notFound()

  return (
    <IntentPage
      navState={await resolveNavState()}
      eyebrow="Integration"
      title="Give forum members timely answers in Discourse"
      intro="Bring timely answers from your docs into Discourse topics and replies. Your team reviews drafts and chooses when to enable automatic replies."
      audience="Discourse admins and community managers who want AI answers without moving their forum to a new platform."
      highlights={[
        {
          title: 'Keep your forum as-is',
          body: 'answerLoops reads new topics and posts through Discourse’s API — no migration, no new platform for your members to learn.',
        },
        {
          title: 'Help members find the guidance they need',
          body: 'Connect your documentation, past resolutions, and other sources so replies are grounded in what your team actually maintains.',
        },
        {
          title: 'Review answers before they reach members',
          body: 'A separate review agent checks each draft against its sources and assigns a confidence score before anything posts automatically.',
        },
        {
          title: 'Follow up on questions that need a person',
          body: 'Discourse tickets sit in the same queue as Discord, Slack, Circle, and every other connected channel — one place to review what needs a person.',
        },
      ]}
      workflow={[
        {
          step: '01',
          title: 'Connect Discourse',
          body: 'Add your API key and choose which categories or the whole forum to watch.',
        },
        {
          step: '02',
          title: 'Review a batch of drafts',
          body: 'Watch how the review agent scores real questions from your forum before enabling automatic replies.',
        },
        {
          step: '03',
          title: 'Turn on automatic replies',
          body: 'Enable it once you trust the pattern — lower-confidence drafts still wait in your ticket queue.',
        },
      ]}
      comparison={[
        {
          question: 'Does this replace Discourse?',
          answer:
            'No. answerLoops connects to the Discourse forum you already run and adds AI-drafted, AI-reviewed answers — it isn’t a new community platform to migrate to.',
        },
        {
          question: 'Does answerLoops use the same review process here as Discord or Slack?',
          answer:
            'Yes. Every channel, including Discourse, goes through the same drafting and dual-agent review pipeline — a separate agent checks each draft against its sources before a confidence score is assigned.',
        },
        {
          question: 'Can I connect Discourse alongside other channels?',
          answer:
            'Yes. Discord, Slack, Circle, GitHub, Telegram, email, Google Chat, and the website widget all use the same workspace knowledge and the same ticket queue.',
        },
      ]}
      docs={[
        {
          label: 'Discourse setup',
          href: '/docs/integrations/discourse',
        },
        {
          label: 'How dual-agent review works',
          href: '/dual-agent-ai-support',
        },
        {
          label: 'Running AI support inside a Discourse forum',
          href: '/blog/discourse-forum-support',
        },
      ]}
      schema={{
        name: 'Add AI-reviewed answers to your Discourse forum',
        description:
          'Keep your Discourse forum. Add AI-drafted, AI-reviewed answers to new topics and posts from your own documentation, with automatic replies you control.',
        path: '/discourse-ai-answers',
      }}
    />
  )
}
