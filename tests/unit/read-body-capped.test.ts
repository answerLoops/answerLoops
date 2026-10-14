import { describe, it, expect } from 'vitest'
import { readBodyCapped, readBodyBytesCapped } from '@/lib/http/read-body-capped'

// The cap is enforced on the bytes actually read from the stream, so neither a
// missing nor a falsified Content-Length gets an oversized body through.

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++])
      else controller.close()
    },
  })
}

describe('readBodyCapped', () => {
  it('returns the text of a body within the cap', async () => {
    const req = new Request('http://x', { method: 'POST', body: 'hello' })
    expect(await readBodyCapped(req, 100)).toBe('hello')
  })

  it('returns an empty string when there is no body', async () => {
    expect(await readBodyCapped({ body: null }, 10)).toBe('')
  })

  it('accepts a body of exactly the cap and rejects one byte more', async () => {
    expect(await readBodyCapped(new Request('http://x', { method: 'POST', body: 'a'.repeat(10) }), 10)).toBe('a'.repeat(10))
    expect(await readBodyCapped(new Request('http://x', { method: 'POST', body: 'a'.repeat(11) }), 10)).toBeNull()
  })

  it('rejects an oversized body even when Content-Length claims it is small', async () => {
    const req = new Request('http://x', { method: 'POST', body: 'a'.repeat(500), headers: { 'content-length': '5' } })
    expect(await readBodyCapped(req, 100)).toBeNull()
  })

  it('rejects a chunked body with no Content-Length once the running total crosses the cap, without reading the rest', async () => {
    let pulled = 0
    const chunk = new Uint8Array(40)
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(chunk)
        if (pulled > 50) controller.close()
      },
    })
    expect(await readBodyCapped({ body }, 100)).toBeNull()
    expect(pulled).toBeLessThan(10)
  })

  it('counts bytes, not characters: multi-byte text over the byte cap is rejected', async () => {
    const text = 'é'.repeat(60) // 60 characters, 120 bytes
    expect(await readBodyCapped(new Request('http://x', { method: 'POST', body: text }), 100)).toBeNull()
    expect(await readBodyCapped(new Request('http://x', { method: 'POST', body: text }), 120)).toBe(text)
  })
})

describe('readBodyBytesCapped', () => {
  it('returns the raw bytes within the cap and null beyond it', async () => {
    const bytes = new Uint8Array([0xff, 0x00, 0x80, 0x41])
    const ok = await readBodyBytesCapped({ body: streamOf([bytes]) }, 4)
    expect(ok && Array.from(ok)).toEqual([0xff, 0x00, 0x80, 0x41])
    expect(await readBodyBytesCapped({ body: streamOf([bytes, bytes]) }, 7)).toBeNull()
  })
})

describe('webhook routes read their bodies through the byte-counting reader', () => {
  const fs = require('node:fs') as typeof import('node:fs')
  const routes = [
    'app/api/slack/events/route.ts',
    'app/api/billing/webhook/route.ts',
    'app/api/github/webhook/route.ts',
    'app/api/discourse/webhook/route.ts',
    'app/api/google-chat/events/route.ts',
    'app/api/circle/webhook/route.ts',
    'app/api/telegram/webhook/route.ts',
    'app/api/ingest/route.ts',
    'app/api/email/ingest/route.ts',
  ]
  it.each(routes)('%s uses readBodyCapped and never req.text()/json() before it', (route) => {
    const src = fs.readFileSync(route, 'utf-8')
    expect(src).toMatch(/readBody(Bytes)?Capped\(/)
    expect(src).not.toMatch(/\b(?:req|request)\.text\(\)/)
    expect(src).not.toMatch(/\b(?:req|request)\.json\(\)/)
    expect(src).not.toMatch(/\b(?:req|request)\.formData\(\)/)
  })
})
