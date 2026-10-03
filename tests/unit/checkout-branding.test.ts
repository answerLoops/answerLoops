import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CHECKOUT_BRANDING } from '@/lib/billing/branding'

/**
 * Checkout branding is passed on every session rather than relying only on
 * the dashboard. These pin the parts that fail silently: a session that
 * forgets it renders Stripe's default look, and an image URL Stripe cannot
 * fetch renders nothing at all.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')

// Width and height straight from the PNG IHDR chunk, so the test needs no
// image library.
function pngSize(rel: string): { width: number; height: number; bytes: number } {
  const buf = fs.readFileSync(path.join(process.cwd(), rel))
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length }
}

// Stripe rejects branding images over 512 KB.
const STRIPE_MAX_IMAGE_BYTES = 512 * 1024

describe('checkout branding', () => {
  it('is applied to both the hosted and the embedded session', () => {
    const src = read('lib/billing/checkout.ts')
    const hosted = src.slice(src.indexOf('export async function createCheckoutSession'), src.indexOf('export async function createEmbeddedCheckoutSession'))
    const embedded = src.slice(src.indexOf('export async function createEmbeddedCheckoutSession'))
    expect(hosted).toContain('branding_settings: CHECKOUT_BRANDING')
    expect(embedded).toContain('branding_settings: CHECKOUT_BRANDING')
  })

  it('uses the app primary button colour and white background', () => {
    const css = read('app/globals.css')
    expect(css).toContain(`--color-brand-600: var(--brand-600, ${CHECKOUT_BRANDING.button_color})`)
    expect(css).toContain(`--background: ${CHECKOUT_BRANDING.background_color};`)
  })

  it('points images at the public site, where Stripe can fetch them', () => {
    // A request-derived origin would be localhost in development and an
    // unreachable preview host elsewhere.
    for (const image of [CHECKOUT_BRANDING.icon, CHECKOUT_BRANDING.logo]) {
      expect(image.type).toBe('url')
      expect(image.url).toMatch(/^https:\/\/answerloops\.com\/[^/]+\.png$/)
    }
  })

  it('serves each referenced image from public/', () => {
    for (const image of [CHECKOUT_BRANDING.icon, CHECKOUT_BRANDING.logo]) {
      const file = path.join('public', new URL(image.url).pathname)
      expect(fs.existsSync(path.join(process.cwd(), file)), file).toBe(true)
    }
  })

  it('uses a square icon of at least 128px, under the size limit', () => {
    const icon = pngSize(path.join('public', new URL(CHECKOUT_BRANDING.icon.url).pathname))
    expect(icon.width).toBe(icon.height)
    expect(icon.width).toBeGreaterThanOrEqual(128)
    expect(icon.bytes).toBeLessThan(STRIPE_MAX_IMAGE_BYTES)
  })

  it('uses a horizontal logo, under the size limit', () => {
    // Checkout's header is a short strip; a square lockup shrinks to fit it
    // and the wordmark becomes unreadable.
    const logo = pngSize(path.join('public', new URL(CHECKOUT_BRANDING.logo.url).pathname))
    expect(logo.width).toBeGreaterThan(logo.height * 2)
    expect(logo.height).toBeGreaterThanOrEqual(128)
    expect(logo.bytes).toBeLessThan(STRIPE_MAX_IMAGE_BYTES)
  })
})
