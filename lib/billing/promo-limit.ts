import { rateLimitShared } from '@/lib/ratelimit'

// Entering a code tells the caller whether it is valid, so an unthrottled
// field is a way to guess codes. Two buckets, because each covers what the
// other cannot: the account bucket stops one signed-in user looping, and the
// address bucket stops someone minting fresh accounts to get fresh allowances.
//
// Only attempts that carry a code are counted. Switching plan or interval
// re-requests a session many times in a normal visit and must never be limited.
const ACCOUNT_MAX = 10
const ADDRESS_MAX = 30
const WINDOW_MS = 10 * 60_000

/**
 * Whether this caller may have a promotion code looked up right now.
 *
 * Both buckets are always charged (not short-circuited), so neither can be
 * drained for free by being second in line.
 */
export async function allowPromoAttempt(accountKey: string, ip: string): Promise<boolean> {
  const [account, address] = await Promise.all([
    rateLimitShared(`checkout-promo-account:${accountKey}`, ACCOUNT_MAX, WINDOW_MS),
    rateLimitShared(`checkout-promo-ip:${ip}`, ADDRESS_MAX, WINDOW_MS),
  ])
  return account.ok && address.ok
}
