import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Known Issues item 46 (Roadmap): 'human_escalation' (Pro+) was declared in
// lib/billing/entitlements.ts but no orgHasFeature call site anywhere in the
// repo ever passed it — escalation behavior triggered purely off whether
// escalationRoleId was set on an integration, with no entitlement check.
// Source-shape assertions, matching this repo's convention (see
// tests/unit/agent-api.test.ts, tests/unit/deflection-quota-gaps.test.ts).

const ROOT = process.cwd()

function readSrc(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('lib/ai/agent.ts — human_escalation entitlement', () => {
  const src = () => readSrc('lib/ai/agent.ts')

  it('imports orgHasFeature', () => {
    expect(src()).toContain("import { orgHasFeature } from '@/lib/billing/entitlements-server'")
  })

  it('gates escalationRoleId on the human_escalation entitlement before it can be used', () => {
    const s = src()
    const rawIdx = s.indexOf('const rawEscalationRoleId = integration?.escalation_role_id ?? null')
    const gateIdx = s.indexOf("orgHasFeature(orgId, 'human_escalation')")
    expect(rawIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeGreaterThan(rawIdx)

    // The gated result, not the raw integration field, must be what flows
    // into both postNeedsHumanReview call sites — a caller reading past the
    // gate and grabbing integration.escalation_role_id directly would
    // silently undo the fix.
    const bugPathCall = s.indexOf('postNeedsHumanReview(', gateIdx)
    const bugPathArgs = s.slice(bugPathCall, s.indexOf(')', s.indexOf(')', bugPathCall) + 1))
    expect(bugPathArgs).toContain('escalationRoleId')
    expect(bugPathArgs).not.toContain('integration?.escalation_role_id')
  })

  it('falls back to null (no mention) rather than the raw role id when the entitlement is missing', () => {
    const s = src()
    const rawIdx = s.indexOf('const rawEscalationRoleId = integration?.escalation_role_id ?? null')
    const block = s.slice(rawIdx, rawIdx + 220)
    expect(block).toMatch(/rawEscalationRoleId\s*&&\s*\(await orgHasFeature\(orgId, 'human_escalation'\)\)\s*\n\s*\?\s*rawEscalationRoleId\s*\n\s*:\s*null/)
  })

  it('the escalated log flag reflects the gated variable, not raw integration state', () => {
    const s = src()
    expect(s).toContain('escalated: !!escalationRoleId')
    // Only one identifier named escalationRoleId should exist post-gate —
    // no shadowing/second declaration that could reintroduce the raw value
    // under the same name.
    const declarations = [...s.matchAll(/const escalationRoleId = /g)]
    expect(declarations.length).toBe(1)
  })
})

describe('lib/billing/entitlements.ts — human_escalation stays a Pro+ feature', () => {
  it('is declared and only unlocked at pro/enterprise', () => {
    const s = readSrc('lib/billing/entitlements.ts')
    expect(s).toContain("'human_escalation'")
    expect(s).toContain("const PRO_FEATURES: Feature[] = [...STANDARD_FEATURES, 'white_label_widget', 'csat_scoring', 'human_escalation'")
  })
})
