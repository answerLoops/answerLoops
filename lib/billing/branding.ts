import type Stripe from 'stripe'

/**
 * How Stripe Checkout looks, set per session so it lives in the repository
 * instead of only in the Stripe dashboard.
 *
 * Applied to both the hosted and the embedded session in ./checkout.ts. The
 * dashboard's account-level branding still governs everything Stripe renders
 * outside a Checkout Session — invoices, receipts, the billing portal — so
 * keep the two in agreement when either changes.
 *
 * The images are absolute URLs on the public site, never derived from the
 * request origin: Stripe fetches them from its own servers, so a localhost or
 * preview origin would hand it an address it cannot reach. The same reason
 * the transactional emails hardcode https://answerloops.com/logo.png.
 *
 * Values mirror app/globals.css: button is brand-600 (the colour every
 * primary button in the app uses), background is --background. Geist is not
 * among Stripe's fonts; Inter is the closest of the ones it offers.
 */
export const CHECKOUT_BRANDING = {
  display_name: 'answerLoops',
  background_color: '#ffffff',
  button_color: '#2563eb',
  border_style: 'rounded',
  font_family: 'inter',
  // Square mark, for the places Checkout shows a small badge.
  icon: { type: 'url', url: 'https://answerloops.com/icon.png' },
  // Horizontal mark + wordmark. public/logo.png is the stacked square
  // lockup, which Checkout shrinks to an unreadable size in its header.
  logo: { type: 'url', url: 'https://answerloops.com/checkout-logo.png' },
} satisfies Stripe.Checkout.SessionCreateParams.BrandingSettings
