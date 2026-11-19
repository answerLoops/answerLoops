import { publicPageMetadata } from '@/lib/marketing/metadata'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ComparisonPage } from '@/components/marketing/comparison-page'
import { marketingSiteEnabled } from '@/lib/site'
import { PLANS } from '@/lib/billing/plans'
import { formatPrice } from '@/lib/marketing/pricing'

// What Fin lists on fin.ai/pricing, read November 17, 2026. Kept as numbers so
// the example below is arithmetic rather than a retyped total.
const FIN_CENTS_PER_OUTCOME = 99
const FIN_SEAT_DOLLARS_PER_MONTH = 19
const FIN_MIN_OUTCOMES_OTHER_HELPDESK = 50
const EXAMPLE_ANSWERED_QUESTIONS = 500

const standard = PLANS.standard

export const dynamic = 'force-dynamic'
export const metadata: Metadata = publicPageMetadata({
  title: 'Intercom Fin Alternative: answerLoops vs Intercom Fin',
  description:
    'Intercom Fin vs answerLoops: compare cost per answered question, channels, the helpdesk you already use, and whether you want to run it yourself (AGPL-3.0).',
  path: '/vs/intercom',
})
export default function Page() {
  // Not served by a self-hosted install: there is no hosted plan to sell there,
  // and the page would be advertising our pricing from somebody else's domain.
  if (!marketingSiteEnabled()) notFound()

  return (
    <ComparisonPage
      competitor="Intercom Fin"
      slug="intercom"
      source="https://fin.ai/"
      reviewedOn="November 17, 2026"
      competitorSummary="Intercom combines a helpdesk with Fin, its AI customer agent. Fin also connects to other helpdesks."
      intro="Intercom Fin and answerLoops both offer AI answers and human follow-up. Compare the channels you need, the helpdesk you already use, and whether you want to operate the application yourself."
      rows={[
        {
          feature: 'Channels',
          us: 'Discord, Slack, Discourse, Circle, GitHub, Telegram, email, Google Chat, and a website widget.',
          them: 'Fin lists chat, email, voice, Slack, and social channels.',
        },
        {
          feature: 'Pricing model',
          us: 'Flat monthly plan, with an estimated number of AI replies included based on the pricing tier.',
          them: `Fin lists ${formatPrice(FIN_CENTS_PER_OUTCOME)} per outcome: a resolution, or a handoff you configure Fin to make. One outcome is billed per conversation, and Fin lists no setup or platform fees.`,
        },
        {
          feature: `Example: ${EXAMPLE_ANSWERED_QUESTIONS} answered questions a month`,
          us: `${formatPrice(standard.priceMonthly)} on Standard, which includes an estimated ${(standard.deflectionsPerMonth ?? 0).toLocaleString('en-US')} AI replies. These count AI replies, not confirmed resolutions. Drafts held for your team do not count, and AI usage is included up to a limit.`,
          them: `${EXAMPLE_ANSWERED_QUESTIONS} resolutions at ${formatPrice(FIN_CENTS_PER_OUTCOME)} is ${formatPrice(EXAMPLE_ANSWERED_QUESTIONS * FIN_CENTS_PER_OUTCOME)}. If Intercom is your helpdesk, its seats are extra (listed at ${formatPrice(FIN_SEAT_DOLLARS_PER_MONTH * 100)} per seat per month; the plan sets the price). Used with another helpdesk, Fin lists a minimum of ${FIN_MIN_OUTCOMES_OTHER_HELPDESK} outcomes a month.`,
        },
        {
          feature: 'Answer workflow',
          us: 'An answer agent drafts from workspace knowledge, a review agent checks it, and automatic replies go out when enabled and above the configured threshold.',
          them: 'Fin answers customer questions and hands conversations to a human team with context.',
        },
        {
          feature: 'Second-AI review before posting',
          us: 'A separate review agent checks every draft against its sources and scores it. Automatic replies need a score above your threshold, and everything else waits for your team.',
          them: 'Fin’s site mentions “checks and balances” for accuracy but does not describe a second AI checking each answer before it is sent.',
        },
        {
          feature: 'Deployment',
          us: 'Managed plans or an AGPL-3.0 self-hosted deployment. External model and channel services still process relevant content.',
          them: 'Fin is available with Intercom or connected to another helpdesk.',
        },
      ]}
      bestFor={{
        us: 'You want documentation-based answers across community channels, a flat monthly price instead of a per-resolution charge, control over automatic replies, and the option to operate the AGPL-3.0 application yourself.',
        them: 'You need a helpdesk and AI customer agent together, want to add Fin to an existing helpdesk, or prefer to pay only when Fin resolves a conversation.',
      }}
    />
  )
}
