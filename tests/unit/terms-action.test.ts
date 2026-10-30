import { beforeEach, describe, expect, it, vi } from 'vitest'

// The server side of the terms step: the terms are required whatever the
// browser sent, nothing is recorded or started without them, and the redirect
// target can only be a path on this site.

const h = vi.hoisted(() => ({
  session: { user: { id: '7', email: 'a@acme.io' } } as { user?: { id: string; email: string } } | null,
  updated: [] as unknown[],
  owned: [{ orgId: 11 }] as unknown[],
  beginTrial: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock('next/navigation', () => ({ redirect: h.redirect }))
vi.mock('@/auth', () => ({ auth: async () => h.session }))
vi.mock('@/lib/auth/signup', () => ({ beginTrial: h.beginTrial }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/db/drizzle', () => ({
  getDb: () => ({
    update: () => ({
      set: (v: unknown) => {
        h.updated.push(v)
        return { where: () => ({ returning: async () => [{ email: 'a@acme.io', name: 'Pat', providerAccountId: 'g-1' }] }) }
      },
    }),
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => h.owned }) }) }) }),
  }),
}))

import { acceptTerms } from '@/lib/actions/terms'
import { safeNextPath } from '@/lib/auth/next-path'

beforeEach(() => {
  h.session = { user: { id: '7', email: 'a@acme.io' } }
  h.updated = []
  h.owned = [{ orgId: 11 }]
  h.beginTrial.mockReset().mockResolvedValue(undefined)
  h.redirect.mockClear()
})

describe('acceptTerms', () => {
  it('refuses without the terms and records and starts nothing', async () => {
    const out = await acceptTerms({ terms: false, marketing: true })
    expect(out).toMatchObject({ error: expect.stringMatching(/accept/i) })
    expect(h.updated).toHaveLength(0)
    expect(h.beginTrial).not.toHaveBeenCalled()
  })

  it('treats anything but a literal true as not accepted', async () => {
    const out = await acceptTerms({ terms: 'true' as unknown as boolean, marketing: false })
    expect(out).toMatchObject({ error: expect.any(String) })
    expect(h.beginTrial).not.toHaveBeenCalled()
  })

  it('sends a signed-out caller to sign in', async () => {
    h.session = null
    await expect(acceptTerms({ terms: true, marketing: false })).rejects.toThrow('NEXT_REDIRECT:/login')
    expect(h.updated).toHaveLength(0)
  })

  it('records the acceptance, starts the trial for the workspace they own, and goes to the dashboard', async () => {
    await expect(acceptTerms({ terms: true, marketing: true })).rejects.toThrow('NEXT_REDIRECT:/dashboard')
    expect(h.updated).toHaveLength(1)
    expect(h.beginTrial).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, orgId: 11, email: 'a@acme.io', providerAccountId: 'g-1' }),
    )
  })

  it('marketing off means no opt-in time is stored', async () => {
    await expect(acceptTerms({ terms: true, marketing: false })).rejects.toThrow()
    expect(h.updated[0]).toMatchObject({ marketingOptIn: false, marketingOptInAt: null })
  })

  it('records the terms but starts no trial for someone who owns no workspace', async () => {
    h.owned = []
    await expect(acceptTerms({ terms: true, marketing: false })).rejects.toThrow('NEXT_REDIRECT:/dashboard')
    expect(h.beginTrial).not.toHaveBeenCalled()
  })

  it('carries the person on to where they were headed', async () => {
    await expect(acceptTerms({ terms: true, marketing: false, callbackUrl: '/invite/abc' })).rejects.toThrow('NEXT_REDIRECT:/invite/abc')
  })
})

describe('safeNextPath', () => {
  it.each([
    ['/invite/abc', '/invite/abc'],
    ['/tickets?x=1', '/tickets?x=1'],
    [undefined, '/dashboard'],
    ['', '/dashboard'],
    ['https://evil.test', '/dashboard'],
    ['//evil.test', '/dashboard'],
    ['/\\evil.test', '/dashboard'],
    ['dashboard', '/dashboard'],
    ['/accept-terms', '/dashboard'],
    ['/accept-terms?callbackUrl=/x', '/dashboard'],
  ])('%s -> %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected)
  })
})
