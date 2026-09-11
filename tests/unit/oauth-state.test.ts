import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import { signOAuthState, verifyOAuthState } from '@/lib/oauth/state'

// The signed `state` helper shared by the Discord / Slack / GitHub / Outlook
// outbound OAuth + app-install flows. It guarantees the callback only accepts
// an `orgId` this server signed, and (combined with the per-callback
// membership check) only for an org the current caller belongs to.

beforeAll(() => {
  process.env.AUTH_SECRET ??= 'test-secret-for-oauth-state'
})

describe('lib/oauth/state', () => {
  it('round-trips a payload', () => {
    const raw = signOAuthState({ orgId: 42, from: 'onboarding' })
    const decoded = verifyOAuthState(raw)
    expect(decoded.orgId).toBe(42)
    expect(decoded.from).toBe('onboarding')
    expect(typeof decoded.ts).toBe('number')
  })

  it('rejects a tampered payload (orgId swapped)', () => {
    const raw = signOAuthState({ orgId: 1 })
    const [body] = raw.split('.')
    const forgedBody = Buffer.from(JSON.stringify({ orgId: 999, ts: Date.now() }), 'utf8').toString('base64url')
    // keep the original signature, swap the body
    const forged = `${forgedBody}.${raw.slice(raw.lastIndexOf('.') + 1)}`
    expect(() => verifyOAuthState(forged)).toThrow()
    expect(body).not.toBe(forgedBody)
  })

  it('rejects a signature made with a different secret', () => {
    const raw = signOAuthState({ orgId: 7 })
    process.env.AUTH_SECRET = 'a-different-secret'
    try {
      expect(() => verifyOAuthState(raw)).toThrow(/signature/)
    } finally {
      process.env.AUTH_SECRET = 'test-secret-for-oauth-state'
    }
  })

  it('rejects an expired state', () => {
    const raw = signOAuthState({ orgId: 7, ts: Date.now() - 11 * 60 * 1000 })
    expect(() => verifyOAuthState(raw)).toThrow(/expired/)
  })

  it('rejects a missing or malformed value', () => {
    expect(() => verifyOAuthState(null)).toThrow()
    expect(() => verifyOAuthState('')).toThrow()
    expect(() => verifyOAuthState('no-dot-here')).toThrow()
  })
})

// Structural checks that each callback actually wires the helper + membership
// check in, with no unsigned-decode or default-org fallback left behind.
const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8')

describe('OAuth callbacks authenticate state and bind it to the caller org', () => {
  const cases: Array<[string, string]> = [
    ['app/api/discord/callback/route.ts', 'discord'],
    ['app/api/slack/callback/route.ts', 'slack'],
    ['app/api/github/callback/route.ts', 'github'],
    ['app/api/email/outlook/callback/route.ts', 'outlook'],
  ]

  for (const [file] of cases) {
    it(`${file} verifies the signature, checks membership, and has no default-org fallback`, () => {
      const src = read(file)
      expect(src).toContain('verifyOAuthState(')
      expect(src).toContain('requireOrgAccess()')
      expect(src).toMatch(/decoded\.orgId !== access\.orgId/)
      expect(src).not.toContain('DEFAULT_ORG_ID')
      expect(src).not.toContain("Buffer.from(state ?? '', 'base64url')")
    })
  }

  const installs: string[] = [
    'app/api/discord/invite-url/route.ts',
    'app/api/slack/install/route.ts',
    'app/api/github/install-url/route.ts',
    'app/api/email/outlook/install/route.ts',
  ]
  for (const file of installs) {
    it(`${file} signs the state and resolves org from a membership row`, () => {
      const src = read(file)
      expect(src).toContain('signOAuthState(')
      expect(src).toContain('requireOrgAccess()')
      expect(src).not.toContain('DEFAULT_ORG_ID')
    })
  }
})

describe('GitHub webhook fails closed without a secret', () => {
  it('rejects with 503 when GITHUB_WEBHOOK_SECRET is unset instead of skipping verification', () => {
    const src = read('app/api/github/webhook/route.ts')
    expect(src).toMatch(/if \(!secret\)[\s\S]{0,200}503/)
    expect(src).not.toContain('if (secret && !verifySignature')
  })
})

describe('AI config writes are owner/admin only', () => {
  it('every ai-config action gates on requireOrgAccess([owner, admin])', () => {
    const src = read('app/actions/ai-config.ts')
    expect(src).not.toContain('DEFAULT_ORG_ID')
    // one shared owner/admin gate helper, called by save, clear, and test
    expect(src).toContain("requireOrgAccess(['owner', 'admin'])")
    for (const fn of ['saveAIConfigAction', 'clearAIConfigAction', 'testAIConfigAction']) {
      const body = src.slice(src.indexOf(`export async function ${fn}`))
      const end = body.indexOf('\nexport ', 1)
      expect((end === -1 ? body : body.slice(0, end)), fn).toContain('resolveOrgForAIConfig()')
    }
  })

  it('the ai-config read routes drop the default-org fallback', () => {
    for (const f of ['app/api/ai-config/route.ts', 'app/api/ai-config/trial-status/route.ts']) {
      const src = read(f)
      expect(src).toContain('requireOrgAccess()')
      expect(src).not.toContain('DEFAULT_ORG_ID')
    }
  })
})
