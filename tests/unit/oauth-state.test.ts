import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import {
  clearOAuthNonceCookie,
  createOAuthState,
  oauthNonceCookieName,
  setOAuthNonceCookie,
  signOAuthState,
  verifyOAuthCallback,
  verifyOAuthState,
} from '@/lib/oauth/state'

// The signed `state` helper shared by the Discord / Slack / GitHub / Outlook
// outbound OAuth + app-install flows. It guarantees the callback only accepts
// an `orgId` this server signed, and (combined with the per-callback
// membership check) only for an org the current caller belongs to.

beforeAll(() => {
  process.env.AUTH_SECRET ??= 'test-secret-for-oauth-state'
})

const NONCE = 'n'.repeat(32)
const base = { orgId: 42, uid: 7, nonce: NONCE, provider: 'slack' as const }

describe('lib/oauth/state', () => {
  it('round-trips a payload', () => {
    const raw = signOAuthState({ ...base, from: 'onboarding' })
    const decoded = verifyOAuthState(raw)
    expect(decoded.orgId).toBe(42)
    expect(decoded.uid).toBe(7)
    expect(decoded.nonce).toBe(NONCE)
    expect(decoded.provider).toBe('slack')
    expect(decoded.from).toBe('onboarding')
    expect(typeof decoded.ts).toBe('number')
  })

  it('rejects a tampered payload (orgId or uid swapped)', () => {
    const raw = signOAuthState(base)
    const sig = raw.slice(raw.lastIndexOf('.') + 1)
    for (const patch of [{ orgId: 999 }, { uid: 999 }]) {
      const forgedBody = Buffer.from(JSON.stringify({ ...base, ts: Date.now(), ...patch }), 'utf8').toString('base64url')
      expect(() => verifyOAuthState(`${forgedBody}.${sig}`)).toThrow(/signature/)
    }
  })

  it('rejects a signature made with a different secret', () => {
    const raw = signOAuthState(base)
    process.env.AUTH_SECRET = 'a-different-secret'
    try {
      expect(() => verifyOAuthState(raw)).toThrow(/signature/)
    } finally {
      process.env.AUTH_SECRET = 'test-secret-for-oauth-state'
    }
  })

  it('rejects an expired state', () => {
    const raw = signOAuthState({ ...base, ts: Date.now() - 11 * 60 * 1000 })
    expect(() => verifyOAuthState(raw)).toThrow(/expired/)
  })

  it('rejects a missing or malformed value', () => {
    expect(() => verifyOAuthState(null)).toThrow()
    expect(() => verifyOAuthState('')).toThrow()
    expect(() => verifyOAuthState('no-dot-here')).toThrow()
  })

  it('rejects a signed payload that lacks a user id or nonce', () => {
    const noUid = signOAuthState({ orgId: 1, nonce: NONCE, provider: 'slack' } as never)
    const noNonce = signOAuthState({ orgId: 1, uid: 1, provider: 'slack' } as never)
    expect(() => verifyOAuthState(noUid)).toThrow(/payload/)
    expect(() => verifyOAuthState(noNonce)).toThrow(/payload/)
  })
})

describe('createOAuthState + verifyOAuthCallback', () => {
  const caller = { userId: 7, orgId: 42 }

  it('accepts the issuing user with the matching nonce cookie', () => {
    const { state, nonce } = createOAuthState({ provider: 'github', orgId: 42, userId: 7, from: 'onboarding' })
    const decoded = verifyOAuthCallback({ provider: 'github', state, cookieNonce: nonce, caller })
    expect(decoded).toMatchObject({ orgId: 42, uid: 7, provider: 'github', from: 'onboarding' })
  })

  it('issues a fresh random nonce each time', () => {
    const a = createOAuthState({ provider: 'slack', orgId: 1, userId: 1 })
    const b = createOAuthState({ provider: 'slack', orgId: 1, userId: 1 })
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.nonce.length).toBeGreaterThanOrEqual(16)
  })

  it('rejects a different signed-in user', () => {
    const { state, nonce } = createOAuthState({ provider: 'slack', orgId: 42, userId: 7 })
    expect(() =>
      verifyOAuthCallback({ provider: 'slack', state, cookieNonce: nonce, caller: { userId: 8, orgId: 42 } }),
    ).toThrow(/user mismatch/)
  })

  it('rejects a caller now acting in a different org', () => {
    const { state, nonce } = createOAuthState({ provider: 'slack', orgId: 42, userId: 7 })
    expect(() =>
      verifyOAuthCallback({ provider: 'slack', state, cookieNonce: nonce, caller: { userId: 7, orgId: 43 } }),
    ).toThrow(/org mismatch/)
  })

  it('rejects a replay once the nonce cookie is gone', () => {
    const { state } = createOAuthState({ provider: 'discord', orgId: 42, userId: 7 })
    expect(() => verifyOAuthCallback({ provider: 'discord', state, cookieNonce: undefined, caller })).toThrow(/cookie/)
    expect(() => verifyOAuthCallback({ provider: 'discord', state, cookieNonce: '', caller })).toThrow(/cookie/)
  })

  it('rejects a cookie holding a different nonce', () => {
    const { state } = createOAuthState({ provider: 'discord', orgId: 42, userId: 7 })
    const other = createOAuthState({ provider: 'discord', orgId: 42, userId: 7 })
    expect(() => verifyOAuthCallback({ provider: 'discord', state, cookieNonce: other.nonce, caller })).toThrow(/nonce/)
  })

  it('rejects a state issued for another provider', () => {
    const { state, nonce } = createOAuthState({ provider: 'gmail', orgId: 42, userId: 7 })
    expect(() => verifyOAuthCallback({ provider: 'outlook', state, cookieNonce: nonce, caller })).toThrow(/provider/)
  })

  it('rejects an expired state even with a valid cookie', () => {
    const nonce = 'x'.repeat(24)
    const state = signOAuthState({ orgId: 42, uid: 7, nonce, provider: 'slack', ts: Date.now() - 11 * 60 * 1000 })
    expect(() => verifyOAuthCallback({ provider: 'slack', state, cookieNonce: nonce, caller })).toThrow(/expired/)
  })

  it('sets and clears an httpOnly lax nonce cookie scoped per provider', () => {
    const res = setOAuthNonceCookie(NextResponse.json({}), 'slack', 'abc')
    const set = res.cookies.get(oauthNonceCookieName('slack'))
    expect(set?.value).toBe('abc')
    expect(set?.httpOnly).toBe(true)
    expect(set?.sameSite).toBe('lax')
    expect(set?.maxAge).toBeLessThanOrEqual(600)
    expect(oauthNonceCookieName('slack')).not.toBe(oauthNonceCookieName('github'))

    const cleared = clearOAuthNonceCookie(NextResponse.json({}), 'slack').cookies.get(oauthNonceCookieName('slack'))
    expect(cleared?.value).toBe('')
    expect(cleared?.maxAge).toBe(0)
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
    ['app/api/email/gmail/callback/route.ts', 'gmail'],
  ]

  for (const [file] of cases) {
    it(`${file} verifies the signature, checks membership, and has no default-org fallback`, () => {
      const src = read(file)
      expect(src).toContain('verifyOAuthCallback(')
      expect(src).toContain("requireOrgAccess(['owner', 'admin'])")
      expect(src).toContain('caller: { userId: access.userId, orgId: access.orgId }')
      expect(src).toContain('clearOAuthNonceCookie(')
      expect(src).not.toContain('DEFAULT_ORG_ID')
      expect(src).not.toContain("Buffer.from(state ?? '', 'base64url')")
    })
  }

  const installs: string[] = [
    'app/api/discord/invite-url/route.ts',
    'app/api/slack/install/route.ts',
    'app/api/github/install-url/route.ts',
    'app/api/email/outlook/install/route.ts',
    'app/api/email/gmail/install/route.ts',
  ]
  for (const file of installs) {
    it(`${file} signs the state and resolves org from a membership row`, () => {
      const src = read(file)
      expect(src).toContain('createOAuthState(')
      expect(src).toContain('setOAuthNonceCookie(')
      expect(src).toContain("requireOrgAccess(['owner', 'admin'])")
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
    const src = read('lib/actions/ai-config.ts')
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
