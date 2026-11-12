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
 * What included AI usage covers, in the order a buyer asks: how much, how it
 * relates to the plan allowance, and how to lift it. Only Standard has a figure:
 * the larger plans include more, and the copy says so without inventing a number.
 */
export const INCLUDED_AI_SUMMARY =
  `Hosted plans include AI usage, during your trial and every month after, so you can start without setting anything up. ` +
  `The included amount depends on your plan: Standard covers roughly ${(standard.deflectionsPerMonth ?? 0).toLocaleString('en-US')} answers a month, and higher plans include more. ` +
  `It is separate from your plan's answer allowance, so a plan can reach its included AI usage before its allowance. ` +
  `To remove the limit, connect an account with a supported AI service (like Anthropic or OpenAI) and pay that service directly for the usage, separately from your answerLoops subscription.`
