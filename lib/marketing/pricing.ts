import type { PlanId } from '@/lib/billing/plans'
import { INCLUDED_AI_SUMMARY } from '@/lib/marketing/plan-summary'

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}
/**
 * Plans with no public price. Marketing shows "Custom pricing" and a Talk to us
 * button instead of a price and a trial button, and leaves them out of the
 * price data published for search engines and AI crawlers. Billing is not
 * affected: the plan keeps its Stripe prices in lib/billing/plans.ts.
 */
export const CUSTOM_PRICED_PLAN_IDS: readonly PlanId[] = ['enterprise']

export function isCustomPriced(id: PlanId): boolean {
  return CUSTOM_PRICED_PLAN_IDS.includes(id)
}

export const PLAN_COPY: Record<
  PlanId,
  { description: string; features: string[] }
> = {
  standard: {
    description:
      'Give members timely answers in the channels they already use.',
    features: [
      'All support channels and website widget',
      'Knowledge imports and ticket review',
      'Bring your own AI provider',
      'MCP and REST API access',
      'CSV exports',
      'Email support',
    ],
  },
  pro: {
    description:
      'Improve the answers members get and route tougher questions to your team.',
    features: [
      'Everything in Standard',
      'Customer satisfaction ratings',
      'Escalation routing to your team',
      'Test settings against past tickets',
      'Knowledge gap reports',
      'Remove answerLoops branding from the widget',
      'Priority support',
    ],
  },
  enterprise: {
    description:
      'Support more members with help moving your existing support and configuring the models you need.',
    features: [
      'Everything in Pro',
      'Bring local or custom models, like Ollama or vLLM',
      'Unlimited data retention',
      'Migration assistance',
      'SLA tracking and breach alerts',
      'Custom invoicing and dedicated contact',
    ],
  },
}
export const PRICING_FAQ = [
  {
    q: 'What counts toward my AI reply allowance?',
    a: 'An AI reply is an answer answerLoops posts on its own, with confidence above your threshold and no person stepping in. Answers generated through MCP or the REST API count too when they meet the confidence requirement. Drafts held for your team to review do not count, including ones a team member later approves or edits. Your allowance renews each calendar month, including on annual subscriptions.',
  },
  {
    q: 'What happens at the monthly limit?',
    a: 'Standard pauses automatic replies at 500; new questions remain available for your team. Pro includes 3,000 and continues beyond that at $5 per additional block of 100, rounded up. Enterprise has no reply limit.',
  },
  {
    q: 'What does the trial include?',
    a: 'Every new hosted account gets one free 14-day trial with every feature included. No card is required and there is no obligation. When it ends you choose a plan and add a card to continue; nothing is charged before then. AI usage is included during the trial, up to a limit, so you can try everything without a provider key.',
  },
  {
    q: 'Are AI model costs included?',
    a: `${INCLUDED_AI_SUMMARY} Your provider then bills model usage directly, including the calls used for drafting, review, and knowledge search, and answerLoops does not add a markup. Supported provider accounts work on every plan; custom model endpoints require Enterprise or self-hosting.`,
  },
  {
    q: 'Can I change or cancel my plan?',
    a: 'Use Billing in your workspace to manage your subscription. Upgrades can apply immediately with a prorated charge. Downgrades and cancellations take effect at the end of the paid period. Cancel during the trial to avoid the first subscription charge.',
  },
  {
    q: 'What does self-hosting cost?',
    a: 'The software is available under AGPL-3.0 without a hosted subscription or AI reply limit. You cover infrastructure and model costs and operate the deployment. Contact us separately if you need migration assistance or a support agreement.',
  },
]
