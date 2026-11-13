import { publicPageMetadata } from '@/lib/marketing/metadata'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ComparisonPage } from '@/components/marketing/comparison-page'
import { marketingSiteEnabled } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = publicPageMetadata({
  title: 'Olark Alternative: answerLoops vs Olark',
  description:
    'Olark vs answerLoops: a website chat box with an AI agent, or AI answers in the community channels you already run. Compare channels and pricing.',
  path: '/vs/olark',
})
export default function Page() {
  // Not served by a self-hosted install: there is no hosted plan to sell there,
  // and the page would be advertising our pricing from somebody else's domain.
  if (!marketingSiteEnabled()) notFound()

  return (
    <ComparisonPage
      competitor="Olark"
      slug="olark"
      source="https://www.olark.com/features/"
      reviewedOn={null}
      competitorSummary="Olark is a live chat product for websites. Its AI agent, Aiden, learns from your live site and hands the conversation to a person when it can’t help."
      intro="Olark puts a chat box on your website, with an AI agent in front of your human team. answerLoops answers questions where your community already talks, then checks each draft before it goes out. Which one fits depends on where your customers ask for help."
      rows={[
        {
          feature: 'Where people ask',
          us: 'Discord, Slack, Discourse, Circle, GitHub, Telegram, email, Google Chat, and a website widget.',
          them: 'A chat box on your website. Olark’s features page also lists email follow-up, and WhatsApp and SMS under its Classic product.',
        },
        {
          feature: 'What the AI learns from',
          us: 'Your workspace knowledge. A separate review agent checks each draft before it is sent.',
          them: 'Your live website, plus documents and page snapshots you upload. Olark says the live site wins for questions about the site.',
        },
        {
          feature: 'Handing off to a person',
          us: 'Answers below your confidence threshold are held for your team, and automatic replies stay off until you turn them on.',
          them: 'The conversation moves to a human agent inside the same chat thread.',
        },
        {
          feature: 'How you pay',
          us: 'Hosted plans with an answer allowance, plus the cost of the AI model you connect. See the pricing page for current numbers.',
          them: 'Olark lists its AI agent at $400 a month billed annually with one human seat included, extra seats at $29 each, and says there are no token costs. Human-only live chat is listed at $29 per agent per month.',
        },
        {
          feature: 'Running it yourself',
          us: 'You can use hosted plans or run the AGPL-3.0 application on your own servers. External model and channel services still process relevant content.',
          them: 'Olark’s site doesn’t mention self-hosting.',
        },
      ]}
      bestFor={{
        us: "Your customers ask for help in Discord, Slack, a forum, or GitHub rather than on a website, and you want a review step and a say in when answers go out on their own.",
        them: "Most of your conversations start on your website, you want live chat with your own agents next to an AI agent, and you’d rather have one price that includes the model.",
      }}
    />
  )
}
