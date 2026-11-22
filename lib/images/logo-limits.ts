/**
 * The limits and the wording of the logo upload, kept apart from the image step
 * itself so a browser can use them (the image step needs a server-only library).
 */

/** The largest upload accepted, in bytes. */
export const LOGO_MAX_BYTES = 1024 * 1024
/** The most pixels a source image may hold before it is refused (25 megapixels). */
export const LOGO_MAX_INPUT_PIXELS = 25_000_000
/** The side, in pixels, of the stored square. A smaller source is not enlarged. */
export const LOGO_OUTPUT_SIDE = 256
/** The shortest side a source image may have. */
export const LOGO_MIN_SIDE = 16

export type LogoErrorCode = 'unsupported' | 'too-large' | 'unreadable' | 'too-many-pixels' | 'too-small'

/** Plain wording for each refusal, safe to show to the person who uploaded. */
export const LOGO_ERROR_MESSAGES: Record<LogoErrorCode, string> = {
  unsupported: 'That file is not a PNG, JPEG or WebP image.',
  'too-large': 'The image is larger than 1 MB.',
  unreadable: 'We could not read that image.',
  'too-many-pixels': 'That image is too large in pixels. Use one under 25 megapixels, for example 5000 by 5000.',
  'too-small': 'That image is too small. Use one that is at least 16 by 16 pixels.',
}
