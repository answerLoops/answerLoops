import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { verifyAccountIdentity } from '@/lib/auth/identity'

interface UserRow {
  id: number
  email: string | null
  name?: string | null
  image?: string | null
  provider: string | null
  providerAccountId: string | null
  termsAcceptedAt?: Date | null
  lastLoginAt?: Date | null
}

const { usersStore } = vi.hoisted(() => ({
  usersStore: { rows: [] as UserRow[], nextId: 1 },
}))

const fakeDb = drizzle(async (sql: string, params: unknown[]) => {
  // 1. Account lookup: where provider = $1 and provider_account_id = $2
  if (sql.includes('provider_account_id') && sql.includes('"users"."provider" = $1')) {
    const provider = params[0] as string
    const providerAccountId = params[1] as string
    const found = usersStore.rows.filter(
      (u) => u.provider === provider && u.providerAccountId === providerAccountId,
    )
    return {
      rows: found.map((u) => [u.id, u.email, u.provider, u.providerAccountId]),
    }
  }

  // 2. Email collision check for returning user: where lower(email) = $1 and id != $2
  if (sql.toLowerCase().includes('email') && sql.includes('"users"."id" != $2')) {
    const email = params[0] as string
    const id = params[1] as number
    const found = usersStore.rows.filter(
      (u) => u.email?.toLowerCase() === email.toLowerCase() && u.id !== id,
    )
    return { rows: found.map((u) => [u.id]) }
  }

  // 3. Email lookup: where lower(email) = $1
  if (sql.toLowerCase().includes('email')) {
    const email = params[0] as string
    const found = usersStore.rows.filter((u) => u.email?.toLowerCase() === email.toLowerCase())
    return {
      rows: found.map((u) => [u.id, u.provider, u.providerAccountId]),
    }
  }

  return { rows: [] }
})

vi.mock('@/lib/db/drizzle', () => ({ getDb: () => fakeDb }))

describe('verifyAccountIdentity — Provider-scoped identity & cross-provider protection', () => {
  beforeEach(() => {
    usersStore.rows = []
    usersStore.nextId = 1
  })

  it('allows a first-time GitHub user with an uncontested email', async () => {
    const result = await verifyAccountIdentity({
      provider: 'github',
      providerAccountId: '10001',
      email: 'newuser@example.com',
    })
    expect(result.allowed).toBe(true)
  })

  it('allows a returning GitHub user matching on (provider, providerAccountId)', async () => {
    usersStore.rows.push({
      id: 42,
      email: 'octocat@example.com',
      provider: 'github',
      providerAccountId: '10001',
    })

    const result = await verifyAccountIdentity({
      provider: 'github',
      providerAccountId: '10001',
      email: 'octocat@example.com',
    })

    expect(result.allowed).toBe(true)
  })

  it('allows a returning GitHub user whose primary verified email changed when new email is uncontested', async () => {
    usersStore.rows.push({
      id: 42,
      email: 'old@example.com',
      provider: 'github',
      providerAccountId: '10001',
    })

    const result = await verifyAccountIdentity({
      provider: 'github',
      providerAccountId: '10001',
      email: 'new@example.com',
    })

    expect(result.allowed).toBe(true)
  })

  it('refuses a returning GitHub user whose changed email collides with another user account', async () => {
    usersStore.rows.push({
      id: 42,
      email: 'githubber@example.com',
      provider: 'github',
      providerAccountId: '10001',
    })
    usersStore.rows.push({
      id: 99,
      email: 'taken@example.com',
      provider: 'google',
      providerAccountId: 'goog-99',
    })

    const result = await verifyAccountIdentity({
      provider: 'github',
      providerAccountId: '10001',
      email: 'taken@example.com',
    })

    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.redirectUrl).toBe('/login?error=OAuthAccountNotLinked')
    }
  })

  it('refuses GitHub sign-in when email belongs to an existing Google account (cross-provider collision)', async () => {
    usersStore.rows.push({
      id: 10,
      email: 'alice@company.com',
      provider: 'google',
      providerAccountId: 'google-sub-123',
    })

    const result = await verifyAccountIdentity({
      provider: 'github',
      providerAccountId: '99999',
      email: 'alice@company.com',
    })

    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.redirectUrl).toBe('/login?error=GoogleAccountExists')
    }
  })

  it('refuses Google sign-in when email belongs to an existing GitHub account (cross-provider collision)', async () => {
    usersStore.rows.push({
      id: 20,
      email: 'bob@company.com',
      provider: 'github',
      providerAccountId: 'github-sub-456',
    })

    const result = await verifyAccountIdentity({
      provider: 'google',
      providerAccountId: 'google-sub-789',
      email: 'bob@company.com',
    })

    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.redirectUrl).toBe('/login?error=GitHubAccountExists')
    }
  })

  it('refuses sign-in when existing user has same email but different provider account ID (same provider mismatch)', async () => {
    usersStore.rows.push({
      id: 30,
      email: 'charlie@company.com',
      provider: 'github',
      providerAccountId: 'github-sub-original',
    })

    const result = await verifyAccountIdentity({
      provider: 'github',
      providerAccountId: 'github-sub-different',
      email: 'charlie@company.com',
    })

    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.redirectUrl).toBe('/login?error=OAuthAccountNotLinked')
    }
  })

  it('preserves existing legacy Google accounts where provider or providerAccountId is null', async () => {
    usersStore.rows.push({
      id: 5,
      email: 'legacy@company.com',
      provider: null,
      providerAccountId: null,
    })

    const googleResult = await verifyAccountIdentity({
      provider: 'google',
      providerAccountId: 'new-google-sub',
      email: 'legacy@company.com',
    })
    expect(googleResult.allowed).toBe(true)

    const githubResult = await verifyAccountIdentity({
      provider: 'github',
      providerAccountId: 'new-github-id',
      email: 'legacy@company.com',
    })
    expect(githubResult.allowed).toBe(false)
    if (!githubResult.allowed) {
      expect(githubResult.redirectUrl).toBe('/login?error=GoogleAccountExists')
    }
  })

  it('preserves legacy user where provider is null but providerAccountId is already populated with matching sub', async () => {
    usersStore.rows.push({
      id: 6,
      email: 'partial@company.com',
      provider: null,
      providerAccountId: 'existing-google-sub',
    })

    const matchResult = await verifyAccountIdentity({
      provider: 'google',
      providerAccountId: 'existing-google-sub',
      email: 'partial@company.com',
    })
    expect(matchResult.allowed).toBe(true)

    const mismatchResult = await verifyAccountIdentity({
      provider: 'google',
      providerAccountId: 'different-google-sub',
      email: 'partial@company.com',
    })
    expect(mismatchResult.allowed).toBe(false)
    if (!mismatchResult.allowed) {
      expect(mismatchResult.redirectUrl).toBe('/login?error=OAuthAccountNotLinked')
    }
  })

  it('refuses sign-in when providerAccountId is missing or whitespace', async () => {
    const missingResult = await verifyAccountIdentity({
      provider: 'github',
      providerAccountId: null,
      email: 'user@example.com',
    })
    expect(missingResult.allowed).toBe(false)
    if (!missingResult.allowed) {
      expect(missingResult.redirectUrl).toBe('/login?error=AccessDenied')
    }

    const emptyResult = await verifyAccountIdentity({
      provider: 'github',
      providerAccountId: '   ',
      email: 'user@example.com',
    })
    expect(emptyResult.allowed).toBe(false)
    if (!emptyResult.allowed) {
      expect(emptyResult.redirectUrl).toBe('/login?error=AccessDenied')
    }
  })

  it('refuses sign-in when email is missing or whitespace', async () => {
    const missingEmailResult = await verifyAccountIdentity({
      provider: 'github',
      providerAccountId: '12345',
      email: null,
    })
    expect(missingEmailResult.allowed).toBe(false)
    if (!missingEmailResult.allowed) {
      expect(missingEmailResult.redirectUrl).toBe('/login?error=AccessDenied')
    }

    const emptyEmailResult = await verifyAccountIdentity({
      provider: 'github',
      providerAccountId: '12345',
      email: '   ',
    })
    expect(emptyEmailResult.allowed).toBe(false)
    if (!emptyEmailResult.allowed) {
      expect(emptyEmailResult.redirectUrl).toBe('/login?error=AccessDenied')
    }
  })
})
