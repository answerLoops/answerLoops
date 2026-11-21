import { describe, expect, it } from 'vitest'
import { isWidgetLogoPath, widgetLogoPath } from '@/lib/widget/logo'

const TOKEN = 'c3'.repeat(24)
const VERSION = '0123456789abcdef'

describe('the logo address', () => {
  it('is the widget token and the version, on this site', () => {
    expect(widgetLogoPath(TOKEN, VERSION)).toBe(`/api/widget/logo/${TOKEN}?v=${VERSION}`)
  })

  it('is recognised by the check', () => {
    expect(isWidgetLogoPath(widgetLogoPath(TOKEN, VERSION))).toBe(true)
  })

  it.each([
    ['another host', `https://evil.test/api/widget/logo/${TOKEN}?v=${VERSION}`],
    ['a protocol-relative address', `//evil.test/api/widget/logo/${TOKEN}?v=${VERSION}`],
    ['a different path', `/api/other/${TOKEN}?v=${VERSION}`],
    ['a javascript address', 'javascript:alert(1)'],
    ['a data address', 'data:image/png;base64,AAAA'],
    ['a slug instead of the token', `/api/widget/logo/acme-support?v=${VERSION}`],
    ['a short token', `/api/widget/logo/${'c3'.repeat(10)}?v=${VERSION}`],
    ['capital letters', `/api/widget/logo/${TOKEN.toUpperCase()}?v=${VERSION}`],
    ['a missing version', `/api/widget/logo/${TOKEN}`],
    ['a short version', `/api/widget/logo/${TOKEN}?v=abc`],
    ['an extra query', `/api/widget/logo/${TOKEN}?v=${VERSION}&x=1`],
    ['a trailing path', `/api/widget/logo/${TOKEN}/extra?v=${VERSION}`],
    ['a quote that could end an attribute', `/api/widget/logo/${TOKEN}?v=${VERSION}"`],
    ['a newline', `/api/widget/logo/${TOKEN}?v=${VERSION}\n`],
    ['a space', ` /api/widget/logo/${TOKEN}?v=${VERSION}`],
    ['nothing', ''],
  ])('rejects %s', (_label, value) => {
    expect(isWidgetLogoPath(value)).toBe(false)
  })

  it('rejects anything that is not a string', () => {
    for (const value of [null, undefined, 42, {}, []]) expect(isWidgetLogoPath(value)).toBe(false)
  })
})
