import { createHash } from 'node:crypto'
import sharp from 'sharp'
import {
  LOGO_ERROR_MESSAGES,
  LOGO_MAX_BYTES,
  LOGO_MAX_INPUT_PIXELS,
  LOGO_MIN_SIDE,
  LOGO_OUTPUT_SIDE,
  type LogoErrorCode,
} from '@/lib/images/logo-limits'

export { LOGO_ERROR_MESSAGES, LOGO_MAX_BYTES, LOGO_MAX_INPUT_PIXELS, LOGO_MIN_SIDE, LOGO_OUTPUT_SIDE }
export type { LogoErrorCode }

/**
 * Turns an uploaded picture into a small, square, clean logo, or says plainly
 * why it cannot. Reusable: nothing in here knows about the chat widget, so a
 * workspace or dashboard logo can use the same step later.
 *
 * What it does, in order:
 * 1. Checks the size and works out the real file type from the first bytes of
 *    the file, never from its name or the type the browser declared. Only PNG,
 *    JPEG and WebP are accepted. SVG, GIF, TIFF, AVIF and everything else are
 *    refused before an image library sees them.
 * 2. Decodes it with a pixel limit, so a huge image is refused instead of
 *    being expanded in memory, and a damaged file is refused instead of being
 *    half read.
 * 3. Applies the camera's rotation, crops a centred square, shrinks it (never
 *    enlarging a small image), drops every piece of embedded metadata and
 *    re-encodes it as WebP, keeping transparency.
 *
 * The result is the only thing a caller should store. The original bytes are
 * never returned.
 *
 * An animated WebP is accepted and its first frame is used, so the logo is
 * always a still picture.
 */

export type LogoResult =
  | {
      ok: true
      bytes: Buffer
      contentType: 'image/webp'
      width: number
      height: number
      /** A short fingerprint of the stored bytes, used to version the logo's address. */
      etag: string
    }
  | { ok: false; code: LogoErrorCode; message: string }

function refuse(code: LogoErrorCode): LogoResult {
  return { ok: false, code, message: LOGO_ERROR_MESSAGES[code] }
}

type SniffedFormat = 'png' | 'jpeg' | 'webp'

/** The format the first bytes say this is, or null when it is not one we accept. */
export function sniffLogoFormat(bytes: Uint8Array): SniffedFormat | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // WEBP
  ) {
    return 'webp'
  }
  return null
}

export async function processLogoImage(input: Uint8Array): Promise<LogoResult> {
  if (input.length > LOGO_MAX_BYTES) return refuse('too-large')
  const format = sniffLogoFormat(input)
  if (!format) return refuse('unsupported')

  try {
    const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
    const options = { limitInputPixels: LOGO_MAX_INPUT_PIXELS, failOn: 'warning' as const }

    const meta = await sharp(source, options).metadata()
    // The decoder's own view must agree with the first bytes.
    if (meta.format !== format || !meta.width || !meta.height) return refuse('unreadable')

    // The camera's rotation turns the picture on its side for the values 5 to 8,
    // so the visible width and height swap.
    const turned = (meta.orientation ?? 1) >= 5
    const width = turned ? meta.height : meta.width
    const height = turned ? meta.width : meta.height
    const side = Math.min(width, height)
    if (side < LOGO_MIN_SIDE) return refuse('too-small')

    const outSide = Math.min(LOGO_OUTPUT_SIDE, side)
    // Metadata is dropped by default; nothing here asks for it back.
    const bytes = await sharp(source, options)
      .rotate()
      .resize(outSide, outSide, { fit: 'cover', position: 'centre' })
      .webp({ quality: 88, alphaQuality: 100 })
      .toBuffer()

    return {
      ok: true,
      bytes,
      contentType: 'image/webp',
      width: outSide,
      height: outSide,
      etag: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/pixel limit/i.test(message)) return refuse('too-many-pixels')
    return refuse('unreadable')
  }
}
