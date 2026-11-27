import type { ArticleReviewState } from '@/types'

/**
 * Review states for knowledge-base articles, kept free of server imports so the
 * dashboard controls (client components) can use them.
 *
 *  - 'current': nothing to review. The article answers customers.
 *  - 'needs_review': the team was asked to take another look. The article keeps
 *    answering customers; only the dashboard shows the flag.
 *  - 'superseded': replaced by another article or a documentation link. It is
 *    never used for answers until someone restores it.
 *
 * Who may do what follows the effect on customers: any member can flag an
 * article or clear a flag, because neither changes an answer. Superseding and
 * restoring change what customers are answered from, so they are limited to
 * owners and admins (lib/actions/kb.ts).
 */

export const REVIEW_STATES = ['current', 'needs_review', 'superseded'] as const satisfies readonly ArticleReviewState[]

/** Longest reason someone can give when flagging an article. */
export const REVIEW_NOTE_MAX = 500

/** Longest documentation link a superseded article can point to. */
export const REPLACEMENT_URL_MAX = 2000

/**
 * What each action does to customer answers, stated before the person confirms
 * it. The dashboard shows these words on the confirmation step, and the tests
 * pin them, so the promise and the behavior cannot drift apart.
 */
export const REVIEW_EFFECT = {
  flag: 'Customers still get answers from this article. Your team sees it marked as needing review.',
  clearFlag: 'Removes the needs-review mark. Customers already get answers from this article, and that does not change.',
  supersede: 'This article stops being used for answers. Customers get answers from what replaces it instead.',
  restore: 'This article starts being used for answers again.',
} as const

export function isReviewState(value: unknown): value is ArticleReviewState {
  return typeof value === 'string' && (REVIEW_STATES as readonly string[]).includes(value)
}

/**
 * Normalizes a replacement documentation link, or returns null when it is not
 * an absolute http or https URL within REPLACEMENT_URL_MAX characters.
 */
export function parseReplacementUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > REPLACEMENT_URL_MAX) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname) return null
  return url.toString()
}
