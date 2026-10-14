import { eq } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { newsletterSubscribers } from '../schema'

interface NewsletterSubscriber {
  id: number
  email: string
  unsubscribe_token: string
  unsubscribed_at: string | null
  created_at: string
}

function toSubscriber(row: typeof newsletterSubscribers.$inferSelect): NewsletterSubscriber {
  return {
    id: row.id,
    email: row.email,
    unsubscribe_token: row.unsubscribeToken,
    unsubscribed_at: row.unsubscribedAt,
    created_at: row.createdAt,
  }
}

export async function getSubscriberByEmail(email: string): Promise<NewsletterSubscriber | null> {
  const [row] = await getDb()
    .select()
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, email))
    .limit(1)
  return row ? toSubscriber(row) : null
}

async function createSubscriber(input: {
  email: string
  unsubscribeToken: string
}): Promise<NewsletterSubscriber> {
  const [row] = await getDb()
    .insert(newsletterSubscribers)
    .values({ email: input.email, unsubscribeToken: input.unsubscribeToken })
    .returning()
  return toSubscriber(row)
}

/** Clears a previous unsubscribe and re-activates the row with a fresh token. */
async function resubscribe(
  email: string,
  unsubscribeToken: string
): Promise<NewsletterSubscriber> {
  const [row] = await getDb()
    .update(newsletterSubscribers)
    .set({ unsubscribeToken, unsubscribedAt: null })
    .where(eq(newsletterSubscribers.email, email))
    .returning()
  return toSubscriber(row)
}

/** Idempotent: unsubscribing an already-unsubscribed row is a no-op, not an error. */
export async function unsubscribeByToken(token: string): Promise<NewsletterSubscriber | null> {
  const [row] = await getDb()
    .update(newsletterSubscribers)
    .set({ unsubscribedAt: new Date().toISOString() })
    .where(eq(newsletterSubscribers.unsubscribeToken, token))
    .returning()
  return row ? toSubscriber(row) : null
}

/**
 * Completes a double opt-in: creates the subscriber, or re-activates an
 * unsubscribed one, with a fresh unsubscribe token. `created` is false when
 * the address was already actively subscribed (nothing changed, so no welcome
 * email should follow).
 */
export async function confirmSubscription(
  email: string,
  unsubscribeToken: string
): Promise<{ subscriber: NewsletterSubscriber; created: boolean }> {
  const existing = await getSubscriberByEmail(email)
  if (existing && !existing.unsubscribed_at) return { subscriber: existing, created: false }
  if (existing) return { subscriber: await resubscribe(email, unsubscribeToken), created: true }
  return { subscriber: await createSubscriber({ email, unsubscribeToken }), created: true }
}
