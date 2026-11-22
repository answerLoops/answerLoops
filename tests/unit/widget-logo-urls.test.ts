import { describe, expect, it } from 'vitest'
import { logoVersionMatches, widgetLogoPath, widgetLogoVersionNumber } from '@/lib/widget/logo'

const TOKEN = 'c3'.repeat(24)
const VERSION = '0123456789abcdef'

describe('the logo address', () => {
  it('is the widget token and the version, on this site', () => {
    expect(widgetLogoPath(TOKEN, VERSION)).toBe(`/api/widget/logo/${TOKEN}?v=${VERSION}`)
  })
})

describe('the logo version number', () => {
  it('is the first ten hex characters of the fingerprint, as a whole number', () => {
    expect(widgetLogoVersionNumber('0123456789abcdef')).toBe(parseInt('0123456789', 16))
    expect(widgetLogoVersionNumber('ffffffffffffffff')).toBe(0xffffffffff)
  })

  it('is a safe integer', () => {
    expect(Number.isSafeInteger(widgetLogoVersionNumber('ffffffffffffffff'))).toBe(true)
  })

  it('changes when the image fingerprint changes', () => {
    expect(widgetLogoVersionNumber('0123456789abcdef')).not.toBe(widgetLogoVersionNumber('1123456789abcdef'))
  })

  it('is null for anything that is not a fingerprint', () => {
    for (const value of ['', 'abc', 'XYZ3456789abcdef', '0123456789abcdef0']) {
      expect(widgetLogoVersionNumber(value)).toBeNull()
    }
  })
})

describe('matching a requested version', () => {
  const NUMBER = String(parseInt(VERSION.slice(0, 10), 16))

  it('accepts the fingerprint and its number form', () => {
    expect(logoVersionMatches(VERSION, VERSION)).toBe(true)
    expect(logoVersionMatches(NUMBER, VERSION)).toBe(true)
  })

  it.each([null, '', 'abc', '1', `${NUMBER}0`, 'fedcba9876543210', '12345678901234567890', `${NUMBER}&x=1`])(
    'rejects %s',
    (value) => {
      expect(logoVersionMatches(value, VERSION)).toBe(false)
    }
  )
})
