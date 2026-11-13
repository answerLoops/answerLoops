import { publicPageMetadata } from '@/lib/marketing/metadata'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ComparisonPage } from '@/components/marketing/comparison-page'
import { marketingSiteEnabled } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = publicPageMetadata({
  title: 'HelpCrunch Alternative: answerLoops vs HelpCrunch',
  description:
    'HelpCrunch vs answerLoops: an all-in-one chat and email tool, or AI answers in the community channels you already run. Compare channels and hosting.',
  path: '/vs/helpcrunch',
})
export default function Page() {
  // Not served by a self-hosted install: there is no hosted plan to sell there,
  // and the page would be advertising our pricing from somebody else's domain.
  if (!marketingSiteEnabled()) notFound()

  return (
    <ComparisonPage
      competitor="HelpCrunch"
      slug="helpcrunch"
      source="https://helpcrunch.com/"
      reviewedOn={null}
      competitorSummary="HelpCrunch bundles live chat, a shared inbox, chatbots, a help center and email tools. Its homepage also mentions an AI editor that helps your team write replies and help articles."
      intro="HelpCrunch is an all-in-one customer messaging tool. answerLoops is narrower: it drafts support answers from your documentation, checks them, and posts them in the channels your community already uses. Here is how they line up."
      rows={[
        {
          feature: 'Where people ask',
          us: 'Discord, Slack, Discourse, Circle, GitHub, Telegram, email, Google Chat, and a website widget.',
          them: 'Live chat on your site, email, and messengers. HelpCrunch’s homepage names WhatsApp and Instagram and says “etc.”, so check its current list.',
        },
        {
          feature: 'What the AI does',
          us: 'Drafts answers from your workspace knowledge. A separate review agent scores each draft before it is sent.',
          them: 'The homepage describes chatbots that pre-qualify leads and an AI editor for writing messages and help articles. It doesn’t say whether there is an AI agent that answers from your docs, so ask HelpCrunch.',
        },
        {
          feature: 'Help center',
          us: 'Answers come from the knowledge you connect.',
          them: 'A help center you can publish as its own site or inside the chat widget, with an SEO-friendly editor.',
        },
        {
          feature: 'Control over automatic replies',
          us: 'Automatic replies are off by default. Below your confidence threshold, a person is pulled in.',
          them: 'Not described on the homepage.',
        },
        {
          feature: 'Trial',
          us: 'A card-free 14-day trial. See the pricing page for plan limits.',
          them: 'HelpCrunch’s signup page describes a 14-day trial with no credit card, on a Pro plan for five team members.',
        },
        {
          feature: 'Running it yourself',
          us: 'You can use hosted plans or run the AGPL-3.0 application on your own servers.',
          them: 'HelpCrunch’s site doesn’t mention self-hosting.',
        },
      ]}
      bestFor={{
        us: "Your community lives in Discord, Slack, Discourse, or GitHub, and you want drafted answers checked against your documentation before anything is posted.",
        them: "You want one tool for website chat, email, messengers, a help center and email campaigns, and your own agents handle most of the conversations.",
      }}
    />
  )
}
