import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Circle is ingest-only (stage 1): answerLoops never posts back into Circle.
// Three independent code paths have to agree on that, and a regression in any
// one of them would either crash on a doomed live API call or silently try to
// auto-deflect into a channel with no write path:
//   - lib/channels/post-reply.ts   — the shared send dispatch: circle -> null
//   - lib/actions/tickets.ts       — sendReply(): circle -> null
//   - lib/ai/agent.ts              — autoDeflectEnabled: circle -> false
// Source-string assertions (these modules pull server-only deps).

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')

describe('Circle never posts outbound', () => {
  it('lib/channels/post-reply.ts short-circuits circle to null', () => {
    const src = read('lib/channels/post-reply.ts')
    expect(src).toMatch(/if \(platform === 'circle'\) return null/)
  })

  it('lib/actions/tickets.ts sendReply short-circuits circle to null', () => {
    const src = read('lib/actions/tickets.ts')
    expect(src).toMatch(/if \(ticket\.source_platform === 'circle'\) return null/)
  })

  it('lib/ai/agent.ts autoDeflectEnabled returns false for circle', () => {
    const src = read('lib/ai/agent.ts')
    const start = src.indexOf('const autoDeflectEnabled')
    expect(start).toBeGreaterThan(-1)
    // within a reasonable window of the IIFE head
    const block = src.slice(start, start + 800)
    expect(block).toMatch(/if \(platform === 'circle'\) return false/)
  })
})
