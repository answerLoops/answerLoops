import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Known Issues item 44 (Roadmap): widget chat and the two Discord slash-command
// endpoints called the model directly with no reserveGeneration/commitDeflection
// call, so a plan's monthly deflection allowance was never enforced there — only
// the MCP/Agent API surfaces went through lib/billing/usage.ts. This file checks
// that all three routes now reserve a slot before any model work starts, deny
// with no model call when the reservation is refused, and bill on success —
// same convention as agent-api.test.ts (source-shape assertions on the route
// wiring; lib/billing/usage.ts's own logic is covered by
// tests/unit/metering-reservation.test.ts).

const ROOT = process.cwd()

function readSrc(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('app/api/widget/chat/route.ts — deflection quota', () => {
  const src = () => readSrc('app/api/widget/chat/route.ts')

  it('imports the shared metering functions', () => {
    // Asserted per-symbol rather than as one literal import line: pinning the
    // exact line meant adding releaseGeneration — a strict improvement, since
    // it stops a rejected request from permanently consuming the org's quota —
    // failed a test whose actual subject (that the route meters through the
    // shared path at all) was unaffected.
    const s = src()
    for (const fn of ['reserveGeneration', 'commitDeflection', 'releaseGeneration']) {
      expect(s).toMatch(new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from '@/lib/billing/usage'`))
    }
  })

  it('reserves a slot after resolving the org but before any model/embedding work', () => {
    const s = src()
    const orgResolvedIdx = s.indexOf('const org = await getOrgByWidgetToken(widgetToken)')
    const reserveIdx = s.indexOf('const reservation = await reserveGeneration(org.id)')
    const embedIdx = s.indexOf('await embedText(query, org.id)')
    const streamIdx = s.indexOf('widgetAgent.stream(')

    expect(orgResolvedIdx).toBeGreaterThan(-1)
    expect(reserveIdx).toBeGreaterThan(orgResolvedIdx)
    expect(reserveIdx).toBeLessThan(embedIdx)
    expect(reserveIdx).toBeLessThan(streamIdx)
  })

  it('denies with 402 and never reaches the model call when the reservation is refused', () => {
    const s = src()
    const reserveIdx = s.indexOf('const reservation = await reserveGeneration(org.id)')
    const denyBlock = s.slice(reserveIdx, reserveIdx + 200)
    expect(denyBlock).toContain('if (!reservation.granted)')
    expect(denyBlock).toContain('402')
  })

  it('bills via commitDeflection in onFinish, only after a completed response', () => {
    const s = src()
    const streamIdx = s.indexOf('widgetAgent.stream(')
    const finishIdx = s.indexOf('onFinish:', streamIdx)
    expect(finishIdx).toBeGreaterThan(streamIdx)
    const finishBlock = s.slice(finishIdx, finishIdx + 200)
    // reservationId is the id captured off the reservation made in the
    // onRequest hook (see PendingRun) — the factory never re-derives it from
    // a local `reservation` object, since reservation happens before the
    // agent factory runs at all.
    expect(finishBlock).toContain('commitDeflection(org.id, reservationId)')
  })
})

describe('app/api/slash/ask/route.ts — deflection quota and rate limit', () => {
  const src = () => readSrc('app/api/slash/ask/route.ts')

  it('imports the shared metering and org rate-limit functions', () => {
    const s = src()
    expect(s).toContain("import { reserveGeneration, commitDeflection } from '@/lib/billing/usage'")
    expect(s).toContain("import { orgRateLimitPerMinute } from '@/lib/billing/entitlements-server'")
    expect(s).toContain("import { rateLimitShared } from '@/lib/ratelimit'")
  })

  it('rate-limits and reserves a slot before any model/embedding work, after auth resolves orgId', () => {
    const s = src()
    const orgIdResolvedIdx = s.indexOf("orgId = DEFAULT_ORG_ID")
    const rateLimitIdx = s.indexOf('const rateLimit = await rateLimitShared(`slash-ask:')
    const reserveIdx = s.indexOf('const reservation = await reserveGeneration(orgId)')
    const embedIdx = s.indexOf('await embedText(question, orgId)')
    const generateIdx = s.indexOf('askAgent.generate(')

    expect(orgIdResolvedIdx).toBeGreaterThan(-1)
    expect(rateLimitIdx).toBeGreaterThan(orgIdResolvedIdx)
    expect(reserveIdx).toBeGreaterThan(rateLimitIdx)
    expect(reserveIdx).toBeLessThan(embedIdx)
    expect(reserveIdx).toBeLessThan(generateIdx)
  })

  it('denies with 402 and never reaches generateText when the reservation is refused', () => {
    const s = src()
    const reserveIdx = s.indexOf('const reservation = await reserveGeneration(orgId)')
    const denyBlock = s.slice(reserveIdx, reserveIdx + 250)
    expect(denyBlock).toContain('if (!reservation.granted)')
    expect(denyBlock).toContain('402')
  })

  it('bills via commitDeflection only after generateText succeeds', () => {
    const s = src()
    const generateIdx = s.indexOf('const { text } = await askAgent.generate(')
    const commitIdx = s.indexOf('commitDeflection(orgId, reservation.generationId)')
    expect(commitIdx).toBeGreaterThan(generateIdx)
  })
})

describe('app/api/slash/summarize/route.ts — deflection quota and rate limit', () => {
  const src = () => readSrc('app/api/slash/summarize/route.ts')

  it('imports the shared metering and org rate-limit functions', () => {
    const s = src()
    expect(s).toContain("import { reserveGeneration, commitDeflection } from '@/lib/billing/usage'")
    expect(s).toContain("import { orgRateLimitPerMinute } from '@/lib/billing/entitlements-server'")
    expect(s).toContain("import { rateLimitShared } from '@/lib/ratelimit'")
  })

  it('rate-limits and reserves a slot before generateText, using a distinct bucket prefix from slash/ask', () => {
    const s = src()
    expect(s).toContain('rateLimitShared(`slash-summarize:${orgId}`')
    expect(s).not.toContain('rateLimitShared(`slash-ask:')

    const rateLimitIdx = s.indexOf('const rateLimit = await rateLimitShared(`slash-summarize:')
    const reserveIdx = s.indexOf('const reservation = await reserveGeneration(orgId)')
    const generateIdx = s.indexOf('summarizeAgent.generate(')

    expect(reserveIdx).toBeGreaterThan(rateLimitIdx)
    expect(reserveIdx).toBeLessThan(generateIdx)
  })

  it('denies with 402 and never reaches generateText when the reservation is refused', () => {
    const s = src()
    const reserveIdx = s.indexOf('const reservation = await reserveGeneration(orgId)')
    const denyBlock = s.slice(reserveIdx, reserveIdx + 250)
    expect(denyBlock).toContain('if (!reservation.granted)')
    expect(denyBlock).toContain('402')
  })

  it('bills via commitDeflection only after generateText succeeds', () => {
    const s = src()
    const generateIdx = s.indexOf('const { text } = await summarizeAgent.generate(')
    const commitIdx = s.indexOf('commitDeflection(orgId, reservation.generationId)')
    expect(commitIdx).toBeGreaterThan(generateIdx)
  })
})
