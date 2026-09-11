import type { PlanId } from '@/lib/billing/plans'

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}
export const PLAN_COPY: Record<
  PlanId,
  { description: string; features: string[] }
> = {
  standard: {
    description:
      'For teams organizing community support and reviewing AI replies.',
    features: [
      'All support channels and website widget',
      'Knowledge imports and ticket review',
      'Your choice of supported AI provider',
      'MCP and REST API access',
      'CSV exports and widget branding',
      'Email support',
    ],
  },
  pro: {
    description:
      'For teams adding customer feedback, routing, and model evaluation.',
    features: [
      'Everything in Standard',
      'Customer satisfaction ratings',
      'Escalation routing to your team',
      'Test settings against past tickets',
      'Knowledge gap reports',
      'Priority support',
    ],
  },
  enterprise: {
    description:
      'For larger support volumes and custom deployment requirements.',
    features: [
      'Everything in Pro',
      'Custom model endpoints',
      'Unlimited data retention',
      'Migration assistance',
      'SLA tracking and breach alerts',
      'Custom invoicing and dedicated contact',
    ],
  },
}
export const PRICING_FAQ = [
  {
    q: 'What counts toward my answer allowance?',
    a: 'Automated replies count as deflections. Answers generated through MCP or the REST API also count when they meet the confidence requirement. Drafts sent for human review do not count as automated replies. Your allowance renews each calendar month, including on annual subscriptions.',
  },
  {
    q: 'What happens at the monthly limit?',
    a: 'Standard pauses automatic answering at 500 answers; new questions remain available for your team. Pro includes 3,000 answers and continues beyond that at $5 per additional block of 100, rounded up. Enterprise has no automated-answer limit.',
  },
  {
    q: 'What does the trial include?',
    a: 'A hosted plan starts with a 14-day subscription trial, with the features and answer allowance of your selected plan. A card is required. Cancel before the trial ends to avoid the subscription charge. New workspaces also receive five AI-processed tickets without a provider key; this is a one-time allowance, separate from your plan trial.',
  },
  {
    q: 'Are AI model costs included?',
    a: 'After the five-ticket allowance, connect your AI provider account. Your provider bills model usage directly, including the calls used for drafting, review, and knowledge search. AnswerLoops does not add a markup. Supported provider accounts work on every plan; custom model endpoints require Enterprise or self-hosting.',
  },
  {
    q: 'Can I change or cancel my plan?',
    a: 'Use Billing in your workspace to manage your subscription. Upgrades can apply immediately with a prorated charge. Downgrades and cancellations take effect at the end of the paid period. Cancel during the trial to avoid the first subscription charge.',
  },
  {
    q: 'What does self-hosting cost?',
    a: 'The software is available under AGPL-3.0 without a hosted subscription or deflection limit. You cover infrastructure and model costs and operate the deployment. Contact us separately if you need migration assistance or a support agreement.',
  },
]
