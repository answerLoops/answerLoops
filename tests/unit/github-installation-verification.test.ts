import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  exchangeGithubUserCode,
  userCanAccessInstallation,
  verifyGithubInstallationAccess,
} from '@/lib/github/user-auth'

const ENV = ['GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  process.env.GITHUB_APP_CLIENT_ID = '<client-id>'
  process.env.GITHUB_APP_CLIENT_SECRET = '<client-secret>'
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function json(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response
}

function installs(ids: number[]) {
  return { installations: ids.map((id) => ({ id })) }
}

describe('exchangeGithubUserCode', () => {
  it('returns the user token on success', async () => {
    const fetchImpl = vi.fn(async () => json({ access_token: 'user-token' }))
    expect(await exchangeGithubUserCode('code', fetchImpl as unknown as typeof fetch)).toBe('user-token')
  })

  it('returns null when GitHub reports an error in a 200 response', async () => {
    const fetchImpl = vi.fn(async () => json({ error: 'bad_verification_code' }))
    expect(await exchangeGithubUserCode('code', fetchImpl as unknown as typeof fetch)).toBeNull()
  })

  it('returns null without calling GitHub when client credentials are missing', async () => {
    delete process.env.GITHUB_APP_CLIENT_ID
    const fetchImpl = vi.fn()
    expect(await exchangeGithubUserCode('code', fetchImpl as unknown as typeof fetch)).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('userCanAccessInstallation', () => {
  it('is true when the installation is on the first page', async () => {
    const fetchImpl = vi.fn(async () => json(installs([5, 77])))
    expect(await userCanAccessInstallation('t', 77, fetchImpl as unknown as typeof fetch)).toBe(true)
  })

  it('is false when the installation is not in the user list', async () => {
    const fetchImpl = vi.fn(async () => json(installs([5, 6])))
    expect(await userCanAccessInstallation('t', 77, fetchImpl as unknown as typeof fetch)).toBe(false)
  })

  it('follows pagination until the installation is found', async () => {
    const full = Array.from({ length: 100 }, (_, i) => i + 1)
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(installs(full)))
      .mockResolvedValueOnce(json(installs([500])))
    expect(await userCanAccessInstallation('t', 500, fetchImpl as unknown as typeof fetch)).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('is false when the API call fails', async () => {
    const fetchImpl = vi.fn(async () => json({}, false))
    expect(await userCanAccessInstallation('t', 77, fetchImpl as unknown as typeof fetch)).toBe(false)
  })
})

describe('verifyGithubInstallationAccess', () => {
  it('accepts an installation the authorizing user can access', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/login/oauth/access_token') ? json({ access_token: 'ut' }) : json(installs([42])),
    )
    const result = await verifyGithubInstallationAccess({ code: 'c', installationId: 42, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result).toEqual({ ok: true })
  })

  it('rejects an installation id the user cannot access', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/login/oauth/access_token') ? json({ access_token: 'ut' }) : json(installs([1, 2])),
    )
    const result = await verifyGithubInstallationAccess({ code: 'c', installationId: 42, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result).toEqual({ ok: false, error: 'installation_not_accessible' })
  })

  it('requires an authorization code', async () => {
    const fetchImpl = vi.fn()
    const result = await verifyGithubInstallationAccess({ code: null, installationId: 42, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result).toEqual({ ok: false, error: 'authorization_required' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a code GitHub will not exchange', async () => {
    const fetchImpl = vi.fn(async () => json({ error: 'bad_verification_code' }))
    const result = await verifyGithubInstallationAccess({ code: 'c', installationId: 42, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result).toEqual({ ok: false, error: 'authorization_failed' })
  })

  it('reports a misconfigured server when client credentials are missing', async () => {
    delete process.env.GITHUB_APP_CLIENT_SECRET
    const result = await verifyGithubInstallationAccess({ code: 'c', installationId: 42, fetchImpl: vi.fn() as unknown as typeof fetch })
    expect(result).toEqual({ ok: false, error: 'server_misconfigured' })
  })
})
