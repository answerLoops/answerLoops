import type Stripe from 'stripe'
import { logger } from '@/lib/logger'
import { parsePromoCode } from './promo-code'

export { parsePromoCode }

const MOD = 'billing/promo'

/**
 * Whether a coupon covers the whole bill while it lasts.
 *
 * The duration is deliberately not checked. A forever coupon never needs a card,
 * and a once/repeating coupon needs one only when the discount ends — which
 * Stripe then handles as an ordinary unpaid invoice (see the past_due path in
 * the billing webhook), so both are allowed to start without one.
 */
export function coversFullPrice(coupon: Pick<Stripe.Coupon, 'percent_off' | 'valid'>): boolean {
  return coupon.valid && coupon.percent_off === 100
}

/**
 * What became of a code someone entered on the checkout page.
 *
 * - `none`: no code was entered.
 * - `invalid`: the code does not exist or is no longer active.
 * - `error`: Stripe could not be asked. Reported as such rather than as
 *   `invalid`, so a transient outage is not read as a bad code.
 * - `applied`: a real discount below 100%; the card is still collected.
 * - `no_card`: covers the full price, so the card is optional.
 */
export type PromoResolution =
  | { status: 'none' | 'invalid' | 'error' }
  | { status: 'applied' | 'no_card'; promotionCodeId: string }

/**
 * Looks a promotion code up and decides how checkout should treat it.
 *
 * Every uncertain outcome resolves to no discount and a card: the safe answer
 * to "can this skip the card?" is always no, and a failed lookup never blocks
 * signup.
 */
export async function resolvePromo(
  stripe: Stripe,
  rawCode: string | null | undefined,
): Promise<PromoResolution> {
  if (!rawCode) return { status: 'none' }
  const code = parsePromoCode(rawCode)
  if (!code) return { status: 'invalid' }

  try {
    const { data } = await stripe.promotionCodes.list({
      code,
      active: true,
      limit: 1,
      expand: ['data.promotion.coupon'],
    })
    const promo = data[0]
    const coupon = promo?.promotion.coupon
    if (!promo || !coupon || typeof coupon === 'string' || !coupon.valid) return { status: 'invalid' }
    return {
      status: coversFullPrice(coupon) ? 'no_card' : 'applied',
      promotionCodeId: promo.id,
    }
  } catch (err) {
    logger.warn('Promotion code lookup failed; using the normal checkout flow', { module: MOD, error: err })
    return { status: 'error' }
  }
}
