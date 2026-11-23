import { describe, expect, it } from 'vitest'
import { addressTitle, retitledQuestion } from '@/lib/kb/retitle'

/**
 * Sections imported from a web page before titles carried the page hold the
 * heading alone ("Pro"). The page title was never stored, but the page's
 * address was, so the re-title pass builds the page part from the address.
 */

describe('addressTitle', () => {
  it('uses the path of the page', () => {
    expect(addressTitle('https://answerloops.com/pricing')).toBe('pricing')
  })

  it('drops a file extension from the last part', () => {
    expect(addressTitle('https://x.com/docs/billing/refunds.html')).toBe('docs/billing/refunds')
  })

  it('decodes each part and ignores a trailing slash', () => {
    expect(addressTitle('https://x.com/docs/getting%20started/')).toBe('docs/getting started')
  })

  it('keeps version numbers and other dots that are not a page extension', () => {
    expect(addressTitle('https://x.com/docs/v1.2')).toBe('docs/v1.2')
    expect(addressTitle('https://x.com/releases/2.0')).toBe('releases/2.0')
    expect(addressTitle('https://x.com/docs/node.js')).toBe('docs/node.js')
    expect(addressTitle('https://x.com/guide.PHP')).toBe('guide')
    expect(addressTitle('https://x.com/readme.md')).toBe('readme')
  })

  it('reads hyphens and underscores in a slug as spaces', () => {
    expect(addressTitle('https://x.com/getting-started')).toBe('getting started')
    expect(addressTitle('https://x.com/api_keys/rotate-keys')).toBe('api keys/rotate keys')
  })

  it('keeps a long path short enough to leave room for the heading', () => {
    const title = addressTitle(`https://x.com/${'segment/'.repeat(40)}page`)
    expect(title.length).toBeLessThanOrEqual(120)
    expect(title.endsWith('page')).toBe(true)
  })

  it('keeps a part that cannot be decoded as it is', () => {
    expect(addressTitle('https://x.com/docs/100%/limits')).toBe('docs/100%/limits')
  })

  it('uses the site name for the home page, without www', () => {
    expect(addressTitle('https://x.com/')).toBe('x.com')
    expect(addressTitle('https://www.x.com')).toBe('x.com')
  })

  it('treats an index page as its folder', () => {
    expect(addressTitle('https://x.com/index.html')).toBe('x.com')
    expect(addressTitle('https://x.com/docs/index.htm')).toBe('docs')
  })

  it('ignores the query string and fragment', () => {
    expect(addressTitle('https://x.com/a?b=1#c')).toBe('a')
  })

  it('falls back to the text it was given when it is not an address', () => {
    expect(addressTitle('not a url')).toBe('not a url')
  })
})

describe('retitledQuestion', () => {
  it('puts the page in front of a bare heading', () => {
    expect(retitledQuestion('https://x.com/pricing', 'Pro')).toBe('pricing › Pro')
  })

  it('leaves a heading that is the page title, whatever its case', () => {
    expect(retitledQuestion('https://x.com/pricing', 'Pricing')).toBe('Pricing')
    expect(retitledQuestion('https://x.com/getting-started', 'Getting started')).toBe('Getting started')
  })

  it('never lets a long address crowd the heading out of the title', () => {
    expect(retitledQuestion(`https://x.com/${'segment/'.repeat(40)}page`, 'Install')).toMatch(/ › Install$/)
  })

  it('replaces a title that was only the page address with the readable page title', () => {
    expect(retitledQuestion('https://x.com/pricing', 'https://x.com/pricing')).toBe('pricing')
    expect(retitledQuestion('https://x.com/pricing/', 'https://X.com/pricing')).toBe('pricing')
  })

  it('keeps the result within the 300-character title limit', () => {
    expect(retitledQuestion('https://x.com/pricing', 'h'.repeat(400)).length).toBeLessThanOrEqual(300)
  })
})
