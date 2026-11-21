import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  LOGO_ERROR_MESSAGES,
  LOGO_MAX_BYTES,
  LOGO_OUTPUT_SIDE,
  processLogoImage,
  sniffLogoFormat,
} from '@/lib/images/logo-pipeline'

/**
 * The upload step for logos. It judges a file by its content, accepts only
 * PNG, JPEG and WebP, and returns one small square WebP with no metadata, never
 * the original bytes.
 */

const solid = (width: number, height: number, alpha = 1) =>
  sharp({ create: { width, height, channels: 4, background: { r: 20, g: 120, b: 200, alpha } } })

const png = (w: number, h: number, alpha = 1) => solid(w, h, alpha).png().toBuffer()
const jpeg = (w: number, h: number) => solid(w, h).jpeg().toBuffer()
const webp = (w: number, h: number) => solid(w, h).webp().toBuffer()

async function meta(bytes: Buffer) {
  return sharp(bytes).metadata()
}

describe('what it accepts', () => {
  it.each([
    ['PNG', () => png(300, 300)],
    ['JPEG', () => jpeg(300, 300)],
    ['WebP', () => webp(300, 300)],
  ])('accepts a %s and returns a square WebP', async (_name, make) => {
    const result = await processLogoImage(await make())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.contentType).toBe('image/webp')
    const m = await meta(result.bytes)
    expect(m.format).toBe('webp')
    expect(m.width).toBe(m.height)
  })

  it('judges a file by its content, not its name: PNG bytes are fine whatever they were called', async () => {
    const bytes = await png(200, 200)
    expect((await processLogoImage(bytes)).ok).toBe(true)
  })
})

describe('the picture it returns', () => {
  it('crops a wide image to a centred square', async () => {
    const result = await processLogoImage(await png(1000, 500))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.width).toBe(LOGO_OUTPUT_SIDE)
    expect(result.height).toBe(LOGO_OUTPUT_SIDE)
    const m = await meta(result.bytes)
    expect([m.width, m.height]).toEqual([LOGO_OUTPUT_SIDE, LOGO_OUTPUT_SIDE])
  })

  it('crops a tall image to a square too', async () => {
    const result = await processLogoImage(await jpeg(400, 900))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const m = await meta(result.bytes)
    expect(m.width).toBe(m.height)
  })

  it('keeps the middle of the picture when it crops', async () => {
    // Left third red, middle third green, right third blue: a wide logo whose
    // centre must survive.
    const strip = await sharp({
      create: { width: 900, height: 300, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .composite([
        { input: await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 0, g: 255, b: 0 } } }).png().toBuffer(), left: 300, top: 0 },
        { input: await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toBuffer(), left: 600, top: 0 },
      ])
      .png()
      .toBuffer()
    const result = await processLogoImage(strip)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { data, info } = await sharp(result.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const mid = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels
    expect(data[mid + 1]).toBeGreaterThan(200) // green centre
    expect(data[mid]).toBeLessThan(60)
  })

  it('shrinks a large image to the stored size', async () => {
    const result = await processLogoImage(await png(2000, 2000))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.width).toBe(LOGO_OUTPUT_SIDE)
    expect(result.bytes.length).toBeLessThan(40_000)
  })

  it('does not enlarge a small image', async () => {
    const result = await processLogoImage(await png(64, 64))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.width).toBe(64)
    expect((await meta(result.bytes)).width).toBe(64)
  })

  it('keeps transparency', async () => {
    const result = await processLogoImage(await png(300, 300, 0.5))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const m = await meta(result.bytes)
    expect(m.hasAlpha).toBe(true)
    const { data } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true })
    expect(data[3]).toBeLessThan(250)
  })

  it('strips every piece of embedded metadata', async () => {
    const tagged = await solid(300, 300)
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'Secret Studio', Artist: 'Someone' } }, density: 300 })
      .toBuffer()
    expect((await meta(tagged)).exif).toBeDefined() // the test image really carries some
    const result = await processLogoImage(tagged)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const m = await meta(result.bytes)
    expect(m.exif).toBeUndefined()
    expect(m.icc).toBeUndefined()
    expect(m.xmp).toBeUndefined()
    expect(result.bytes.includes(Buffer.from('Secret Studio'))).toBe(false)
  })

  it('applies the camera rotation before cropping', async () => {
    // 200 wide by 100 tall, marked as needing a quarter turn: it is really 100 by 200.
    const sideways = await solid(200, 100).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const result = await processLogoImage(sideways)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.width).toBe(100)
  })

  it('never hands back the original bytes', async () => {
    const original = await png(300, 300)
    const result = await processLogoImage(original)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bytes.equals(original)).toBe(false)
    expect(sniffLogoFormat(result.bytes)).toBe('webp')
  })

  it('gives the same fingerprint for the same picture and a different one for another', async () => {
    const a = await processLogoImage(await png(300, 300))
    const b = await processLogoImage(await png(300, 300))
    const c = await processLogoImage(await solid(300, 300).tint({ r: 255, g: 0, b: 0 }).png().toBuffer())
    expect(a.ok && b.ok && c.ok).toBe(true)
    if (!a.ok || !b.ok || !c.ok) return
    expect(a.etag).toBe(b.etag)
    expect(a.etag).toMatch(/^[0-9a-f]{16}$/)
    expect(c.etag).not.toBe(a.etag)
  })

  it('uses the first frame of an animated WebP', async () => {
    const frame = (r: number) => sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g: 0, b: 0 } } }).raw().toBuffer()
    const frames = Buffer.concat([await frame(255), await frame(0)])
    const animated = await sharp(frames, { raw: { width: 64, height: 64 * 2, channels: 3, pageHeight: 64 } })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer()
    expect((await meta(animated)).pages).toBe(2)
    const result = await processLogoImage(animated)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((await meta(result.bytes)).pages ?? 1).toBe(1)
  })
})

describe('what it refuses', () => {
  const refused = async (bytes: Uint8Array, code: string) => {
    const result = await processLogoImage(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe(code)
    expect(result.message).toBe(LOGO_ERROR_MESSAGES[result.code])
  }

  it('refuses an SVG, even one that says it is a PNG', async () => {
    await refused(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'), 'unsupported')
    await refused(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'), 'unsupported')
  })

  it('refuses a GIF, an AVIF, a TIFF and a BMP, though an image library could read them', async () => {
    const gif = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#fff' } }).gif().toBuffer()
    const tiff = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#fff' } }).tiff().toBuffer()
    await refused(gif, 'unsupported')
    await refused(tiff, 'unsupported')
    await refused(Buffer.concat([Buffer.from([0x42, 0x4d]), Buffer.alloc(60)]), 'unsupported')
  })

  it('refuses a text file whatever it is called', async () => {
    await refused(Buffer.from('this is just a text file saved as logo.png'), 'unsupported')
  })

  it('refuses an empty file', async () => {
    await refused(Buffer.alloc(0), 'unsupported')
  })

  it('refuses a file over 1 MB before looking at it', async () => {
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(LOGO_MAX_BYTES)])
    await refused(big, 'too-large')
  })

  it('refuses a PNG that is only a header and garbage', async () => {
    await refused(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('not really image data at all')]), 'unreadable')
  })

  it('refuses a truncated JPEG and a truncated PNG', async () => {
    const j = await jpeg(400, 400)
    const p = await png(400, 400)
    await refused(j.subarray(0, Math.floor(j.length / 2)), 'unreadable')
    await refused(p.subarray(0, Math.floor(p.length / 2)), 'unreadable')
  })

  it('refuses a JPEG with a PNG name\'s worth of nonsense in the middle', async () => {
    await refused(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('garbage garbage garbage')]), 'unreadable')
  })

  it('refuses an image with too many pixels, even though its file is small', async () => {
    const huge = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#2563eb' } }).png({ compressionLevel: 9 }).toBuffer()
    expect(huge.length).toBeLessThan(LOGO_MAX_BYTES)
    await refused(huge, 'too-many-pixels')
  })

  it('refuses an image that is too small to be a logo', async () => {
    await refused(await png(8, 8), 'too-small')
    await refused(await png(400, 12), 'too-small')
  })

  it('never throws on arbitrary bytes', async () => {
    for (let i = 0; i < 20; i++) {
      const noise = Buffer.alloc(200 + i * 13)
      for (let j = 0; j < noise.length; j++) noise[j] = (j * 31 + i * 17) % 256
      await expect(processLogoImage(noise)).resolves.toBeDefined()
    }
  })
})

describe('sniffLogoFormat', () => {
  it('recognises the three formats from their first bytes', async () => {
    expect(sniffLogoFormat(await png(20, 20))).toBe('png')
    expect(sniffLogoFormat(await jpeg(20, 20))).toBe('jpeg')
    expect(sniffLogoFormat(await webp(20, 20))).toBe('webp')
  })

  it('recognises nothing else', () => {
    expect(sniffLogoFormat(Buffer.from('<svg/>'))).toBeNull()
    expect(sniffLogoFormat(Buffer.from('GIF89a......'))).toBeNull()
    expect(sniffLogoFormat(Buffer.from('RIFF....WAVE'))).toBeNull()
    expect(sniffLogoFormat(Buffer.alloc(0))).toBeNull()
  })
})
