import { PLANS, TRIAL_DAYS } from '@/lib/billing/plans'

/**
 * Plan copy the marketing site quotes beside the trial button and in the
 * AI-usage answers. Numbers are read from the plan table rather than typed, so
 * a change to a trial length or allowance reaches the copy by itself.
 */

const standard = PLANS.standard

/**
 * The line under every "start your trial" button. It stays short on purpose:
 * prices live on the pricing page, where the plan cards show them on load.
 */
export const TRIAL_CTA_NOTE =
  `No card required. Every feature is free for ${TRIAL_DAYS} days, with no obligation.`

/**
 * What included AI usage covers, in the order a buyer asks: what it is, what
 * uses it, how it relates to the plan allowance, and how to lift it. One short
 * paragraph per question, so the pricing page can show them apart instead of as
 * one long block. It never states an amount of money. Only Standard has a
 * figure, in replies: the larger plans include more, and the copy says so
 * without inventing a number.
 */
export const INCLUDED_AI_POINTS: readonly string[] = [
  `Hosted plans include AI usage, during your trial and every month after, so you can start without setting anything up.`,
  `Every question the AI works on uses some of it, including drafts held for your team. That is why each plan lists estimated AI replies: Standard covers roughly ${(standard.deflectionsPerMonth ?? 0).toLocaleString('en-US')} a month and higher plans include more, but longer questions and sources use more.`,
  `AI replies are counted exactly and separately from this usage, so a plan can reach its included AI usage before its AI reply allowance. When that happens, drafting pauses until your usage resets next month (the trial's does not reset), or until you connect your own AI provider.`,
  `To remove the limit, connect an account with a supported AI service (like Anthropic or OpenAI) and pay that service directly for the usage, separately from your answerLoops subscription.`,
]

/** The same text as one paragraph, for the FAQ and structured data. */
export const INCLUDED_AI_SUMMARY = INCLUDED_AI_POINTS.join(' ')
