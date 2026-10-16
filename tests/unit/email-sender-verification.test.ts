import { describe, it, expect } from 'vitest'
import { compactRawPayload, readSenderVerification, toHeaderPairs, extractHeaderPairs, MAX_STORED_PAYLOAD_BYTES } from '@/lib/email/sender-verification'

describe('readSenderVerification', () => {
  it('verifies on dmarc=pass', () => {
    expect(readSenderVerification({ 'Authentication-Results': 'mx; dmarc=pass header.from=a.test' }, {})).toEqual({
      verified: true,
      source: 'authentication-results',
    })
  })

  it('verifies on spf and dkim both passing when no dmarc result is given', () => {
    expect(readSenderVerification({ 'authentication-results': 'mx; spf=pass; dkim=pass' }, {}).verified).toBe(true)
    expect(readSenderVerification({ 'authentication-results': 'mx; spf=pass; dkim=fail' }, {}).verified).toBe(false)
  })

  it('a failing dmarc result wins over passing spf and dkim', () => {
    expect(readSenderVerification({ 'authentication-results': 'mx; spf=pass; dkim=pass; dmarc=fail' }, {}).verified).toBe(false)
  })

  it('reads the first header of an array of header pairs and ignores later ones', () => {
    const headers = [
      { name: 'Authentication-Results', value: 'mx; dmarc=fail' },
      { name: 'Authentication-Results', value: 'earlier-hop; dmarc=pass' },
    ]
    expect(readSenderVerification(headers, {}).verified).toBe(false)
  })

  it('falls back to payload fields', () => {
    expect(readSenderVerification({}, { SPF: 'pass', DKIM: '{@a.test : pass}' })).toEqual({ verified: true, source: 'payload' })
    expect(readSenderVerification({}, { dmarc: 'fail', spf: 'pass', dkim: 'pass' }).verified).toBe(false)
  })

  it('is unverified when the provider reports nothing', () => {
    expect(readSenderVerification({}, {})).toEqual({ verified: false, source: 'none' })
    expect(readSenderVerification(null, {}).verified).toBe(false)
  })
})

describe('readSenderVerification across provider header shapes', () => {
  const pass = 'mx.test; spf=pass; dkim=pass; dmarc=pass'
  const fail = 'mx.test; spf=pass; dkim=pass; dmarc=fail'
  const shapes: [string, (v: string) => unknown][] = [
    ['raw block', (v) => `Subject: hi\nAuthentication-Results: ${v}\nFrom: a@b.test\n`],
    ['raw block with CRLF and folded lines', (v) => `Subject: hi\r\nAUTHENTICATION-RESULTS: ${v.replace('; ', ';\r\n\t')}\r\nFrom: a@b.test\r\n`],
    ['pair tuples', (v) => [['Subject', 'hi'], ['Authentication-Results', v]]],
    ['JSON string of pair tuples', (v) => JSON.stringify([['Subject', 'hi'], ['authentication-results', v]])],
    ['Name/Value objects', (v) => [{ Name: 'Authentication-Results', Value: v }]],
    ['name/value objects', (v) => [{ name: 'authentication-results', value: v }]],
    ['object map', (v) => ({ 'Authentication-Results': v })],
    ['object map with array values', (v) => ({ 'authentication-results': [v] })],
  ]
  for (const [label, build] of shapes) {
    it(`${label}: pass verifies and dmarc=fail does not`, () => {
      expect(readSenderVerification(build(pass), {})).toEqual({ verified: true, source: 'authentication-results' })
      expect(readSenderVerification(build(fail), {}).verified).toBe(false)
    })
  }

  it('reads a folded raw header as a single value', () => {
    const raw = 'Authentication-Results: mx.test;\n spf=pass\n\tdkim=pass;\n dmarc=pass\n'
    expect(toHeaderPairs(raw)).toEqual([{ name: 'Authentication-Results', value: 'mx.test; spf=pass dkim=pass; dmarc=pass' }])
    expect(readSenderVerification(raw, {}).verified).toBe(true)
  })

  it('only the first Authentication-Results counts in a raw block', () => {
    const raw = 'Authentication-Results: mx.test; dmarc=fail\nAuthentication-Results: other.test; dmarc=pass\n'
    expect(readSenderVerification(raw, {}).verified).toBe(false)
  })

  it('falls back to payload fields with raw headers that have no result', () => {
    expect(readSenderVerification('Subject: hi\n', { SPF: 'pass', dkim: '{@a.test : pass}' })).toEqual({ verified: true, source: 'payload' })
  })

  it('does not treat provider-named spf or dkim headers as a verdict', () => {
    const headers = [['X-Mailgun-Spf', 'Pass'], ['X-Mailgun-Dkim-Check-Result', 'Pass']]
    expect(readSenderVerification(headers, {})).toEqual({ verified: false, source: 'none' })
  })

  it('is unverified for malformed input', () => {
    expect(readSenderVerification('[not json', {}).verified).toBe(false)
    expect(readSenderVerification([null, 3, ['x']], {}).verified).toBe(false)
    expect(readSenderVerification(42, {}).verified).toBe(false)
  })
})

describe('extractHeaderPairs', () => {
  it('finds the header collection under each provider field name', () => {
    const pair = [['Authentication-Results', 'mx; dmarc=pass']]
    for (const key of ['headers', 'Headers', 'message-headers']) {
      expect(extractHeaderPairs({ [key]: pair })).toEqual([{ name: 'Authentication-Results', value: 'mx; dmarc=pass' }])
    }
    expect(extractHeaderPairs({})).toEqual([])
  })
})

describe('compactRawPayload', () => {
  it('keeps selected fields and headers and drops the rest', () => {
    const out = compactRawPayload(
      { from: 'a@b.test', subject: 's', text: 'hello', attachments: ['x'] },
      { 'x-other': '1', 'message-id': '<m>' }
    )
    expect(out).toMatchObject({ from: 'a@b.test', subject: 's', text: 'hello', headers: { 'message-id': '<m>' } })
    expect(out).not.toHaveProperty('attachments')
    expect((out.headers as Record<string, string>)['x-other']).toBeUndefined()
  })

  it('keeps selected headers from a raw header block', () => {
    const out = compactRawPayload({ from: 'a@b.test' }, 'Message-ID: <m>\nX-Other: 1\n')
    expect(out.headers).toEqual({ 'message-id': '<m>' })
  })

  it('never exceeds the stored size limit', () => {
    const out = compactRawPayload({ from: 'a@b.test', text: 't'.repeat(900_000), html: 'h'.repeat(900_000), subject: 's'.repeat(100_000) }, {})
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThanOrEqual(MAX_STORED_PAYLOAD_BYTES)
  })
})
