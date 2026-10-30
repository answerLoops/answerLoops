import { startTrial } from '@/lib/billing/trial'
import { sendWelcomeEmail } from '@/lib/email/send'
import { logger } from '@/lib/logger'

/**
 * Starts the one card-free trial for an org and welcomes the person in.
 *
 * Called once someone has accepted the terms (see lib/actions/terms.ts), and
 * on sign-in for an existing account that has never had a trial. Failure here
 * must not break the caller: an error leaves the org with no subscription,
 * which the access gate treats as "needs to subscribe", and the next sign-in
 * tries again. The welcome email goes out only when a trial actually started,
 * so someone refused a second trial is not greeted as if they had begun one;
 * mail trouble never fails the caller either.
 */
export async function beginTrial(input: {
  userId: number
  orgId: number
  email: string
  name: string | null
  providerAccountId: string | null
}): Promise<void> {
  const { userId, orgId, email, name, providerAccountId } = input
  try {
    const outcome = await startTrial({ orgId, userId, email, providerSubject: providerAccountId })
    if (outcome.status !== 'started') return
    try {
      await sendWelcomeEmail(email, name)
    } catch (err) {
      logger.error('Welcome email failed after trial start', { module: 'auth/signup', orgId, error: err })
    }
  } catch (err) {
    logger.error('Trial start failed', { module: 'auth/signup', orgId, error: err })
  }
}
