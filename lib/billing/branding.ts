import type Stripe from 'stripe'

/**
 * How Stripe Checkout looks, set per session so it lives in the repository
 * instead of only in the Stripe dashboard.
 *
 * Applied to the hosted session in ./checkout.ts; the embedded session uses
 * EMBEDDED_CHECKOUT_BRANDING below. The
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

/**
 * The same look without the images, for the embedded session.
 *
 * Stripe rejects `logo` when `ui_mode` is `embedded_page` ("You cannot set
 * `logo` when `ui_mode` is `embedded_page`"), which failed every embedded
 * session. The form renders inside our own page, under our own header, so
 * there is no Stripe-hosted header or tab to brand: only the colours, shape,
 * font and display name apply. The icon is dropped as well rather than left to
 * be the next rejection — Stripe reports one invalid parameter at a time.
 */
const { logo: _logo, icon: _icon, ...embeddedBranding } = CHECKOUT_BRANDING
export const EMBEDDED_CHECKOUT_BRANDING: Stripe.Checkout.SessionCreateParams.BrandingSettings = embeddedBranding
