import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { embedQueryCached } from '@/lib/widget/embed-cache'
import { getKBContext } from '@/lib/db/queries/kb'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { logger } from '@/lib/logger'

/**
 * Suggested follow-up questions for the website chat.
 *
 * After some answers the assistant may offer two or three questions the
 * visitor might ask next. Two rules sit here, on the server:
 *
 * 1. Availability. A workspace gets them only on a plan that includes widget
 *    customization (Pro and above) and while the owner has not switched them
 *    off. When they are not available the assistant is never told they exist
 *    and the tool is not registered.
 * 2. Grounding. A suggestion is kept only when the workspace's knowledge base
 *    has an article close enough to answer it, using the same search and match
 *    threshold the chat itself uses, so a button never leads to "I don't know".
 */

const MOD = 'widget/follow-ups'

/** How long one suggestion's knowledge-base check may take before it counts as not covered. */
export const FOLLOW_UP_CHECK_TIMEOUT_MS = 4_000

/** The fewest suggestions worth showing; with fewer than this, none are shown. */
export const FOLLOW_UPS_MIN = 2

/** The most suggestions shown at once. */
export const FOLLOW_UPS_MAX = 3

export async function followUpsAvailable(org: { id: number; followUpsEnabled: boolean }): Promise<boolean> {
  if (!org.followUpsEnabled) return false
  return orgHasFeature(org.id, 'white_label_widget')
}

/** Whether the workspace's knowledge base can answer this question. Never throws: a failure means not covered. */
export async function questionIsCovered(orgId: number, question: string): Promise<boolean> {
  try {
    const check = (async () => {
      const vector = await embedQueryCached(question, orgId)
      const matches = await getKBContext(vector, 1, orgId)
      return matches.length > 0
    })()
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), FOLLOW_UP_CHECK_TIMEOUT_MS))
    return await Promise.race([check, timeout])
  } catch (error) {
    logger.debug('follow-up coverage check failed', { module: MOD, orgId, error })
    return false
  }
}

const normalise = (label: string) => label.replace(/\s+/g, ' ').trim()

/**
 * The suggestions the knowledge base can answer, in the order proposed, at most
 * three, or an empty list when fewer than two qualify. Duplicates (ignoring
 * case and spacing) are dropped first. The checks run side by side, so the cost
 * is the slowest one, not the sum. In mock mode there is no knowledge base to
 * ask, so every distinct suggestion passes.
 */
export async function groundFollowUps(
  orgId: number,
  labels: string[],
  covered: (orgId: number, question: string) => Promise<boolean> = questionIsCovered
): Promise<string[]> {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const raw of labels) {
    const label = normalise(raw)
    const key = label.toLowerCase()
    if (!label || seen.has(key)) continue
    seen.add(key)
    unique.push(label)
  }
  const candidates = unique.slice(0, FOLLOW_UPS_MAX)
  const verdicts = MOCK_EXTERNALS ? candidates.map(() => true) : await Promise.all(candidates.map((q) => covered(orgId, q)))
  const kept = candidates.filter((_, i) => verdicts[i])
  return kept.length >= FOLLOW_UPS_MIN ? kept : []
}
