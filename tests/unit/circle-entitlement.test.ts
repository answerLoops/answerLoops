import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// The Circle channel adds one billing feature (`circle_integration`, a
// Standard-plan entitlement) and reuses the generic `integrations` columns —
// there is no migration. These assertions catch the split-brain regression:
// the feature added to the `Feature` union type but left out of
// STANDARD_FEATURES (so it's gated off for every plan), or the server action's
// requireFeature union not widened so `saveCircleIntegrationAction` can't type-
// check its own gate call. They also pin that Circle has NO auto-deflect toggle
// — it is ingest-only, so a deflection field in its schema would be a bug.

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')

describe('lib/billing/entitlements.ts: circle_integration feature', () => {
  const src = read('lib/billing/entitlements.ts')

  it('is part of the Feature union', () => {
    expect(src).toMatch(/\|\s*'circle_integration'/)
  })

  it('is included in STANDARD_FEATURES', () => {
    const line = src.split('\n').find((l) => l.includes('STANDARD_FEATURES')) ?? ''
    expect(line).toContain("'circle_integration'")
  })
})

describe('lib/actions/integrations.ts: Circle action gating', () => {
  const src = read('lib/actions/integrations.ts')

  it('requireFeature union includes circle_integration', () => {
    const sig = src.split('\n').find((l) => l.includes('async function requireFeature')) ?? ''
    expect(sig).toContain("'circle_integration'")
  })

  it('saveCircleIntegrationAction gates on requireFeature(orgId, circle_integration)', () => {
    expect(src).toContain('export async function saveCircleIntegrationAction')
    expect(src).toMatch(/requireFeature\(orgId, 'circle_integration'\)/)
  })

  it('exports deleteCircleIntegrationAction', () => {
    expect(src).toContain('export async function deleteCircleIntegrationAction')
  })

  it('the Circle schema/action has no auto-deflect toggle (ingest-only)', () => {
    const start = src.indexOf('CircleIntegrationSchema')
    const end = src.indexOf('deleteCircleIntegrationAction')
    expect(start).toBeGreaterThan(-1)
    const block = src.slice(start, end)
    expect(block).not.toMatch(/autoDeflect|auto_deflect|deflectionEnabled|automaticDeflection/i)
  })
})
