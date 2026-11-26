import { describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fetchGitHubProfile, type GitHubUserinfoContext } from '@/lib/auth/github'
import { isAllowedSignIn } from '@/lib/auth/signin'

describe('auth.ts — GitHub OAuth provider registration', () => {
  const authSrc = fs.readFileSync(path.join(process.cwd(), 'auth.ts'), 'utf-8')

  it('imports GitHub and delegates to fetchGitHubProfile and isAllowedSignIn', () => {
    expect(authSrc).toMatch(/import\s+GitHub\s+from\s+['"]next-auth\/providers\/github['"]/)
    expect(authSrc).toMatch(/import\s*\{\s*fetchGitHubProfile\s*\}\s*from\s*['"]@\/lib\/auth\/github['"]/)
    expect(authSrc).toMatch(/import\s*\{\s*isAllowedSignIn\s*\}\s*from\s*['"]@\/lib\/auth\/signin['"]/)
  })

  it('registers both Google and GitHub in NextAuth providers', () => {
    const providersBlock = authSrc.slice(authSrc.indexOf('providers: ['), authSrc.indexOf('pages: {'))
    expect(providersBlock).toContain('Google,')
    expect(providersBlock).toContain('GitHub({')
    expect(providersBlock).toContain('fetchGitHubProfile(context)')
  })

  it('delegates signIn callback to isAllowedSignIn', () => {
    const signInBlock = authSrc.slice(authSrc.indexOf('async signIn('), authSrc.indexOf('async authorized('))
    expect(signInBlock).toContain('isAllowedSignIn({ user, account, profile })')
  })
})

describe('fetchGitHubProfile (production identity retrieval)', () => {
  const context: GitHubUserinfoContext = {
    tokens: { access_token: '<mock-access-token>' },
    provider: { userinfo: { url: 'https://api.github.com/user' } },
  }

  function mockFetch(
    userResult: { ok: boolean; data?: unknown },
    emailsResult?: { ok: boolean; data?: unknown },
  ): typeof fetch {
    return vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString()
      if (urlStr.includes('/user/emails')) {
        return {
          ok: emailsResult?.ok ?? false,
          json: async () => emailsResult?.data,
        } as unknown as Response
      }
      return {
        ok: userResult.ok,
        json: async () => userResult.data,
      } as unknown as Response
    }) as unknown as typeof fetch
  }

  it('accepts a public verified primary email', async () => {
    const customFetch = mockFetch(
      { ok: true, data: { id: 1234, login: 'octocat', name: 'Mona Lisa', email: 'mona@github.com', avatar_url: 'https://avatar' } },
      { ok: true, data: [{ email: 'mona@github.com', primary: true, verified: true }] },
    )

    const profile = await fetchGitHubProfile(context, customFetch)
    expect(profile).not.toBeNull()
    expect(profile?.email).toBe('mona@github.com')
    expect(profile?.email_verified).toBe(true)
    expect(profile?.login).toBe('octocat')
  })

  it('resolves a private verified email when public profile email is null', async () => {
    const customFetch = mockFetch(
      { ok: true, data: { id: 5678, login: 'coder', name: null, email: null, avatar_url: 'https://avatar' } },
      { ok: true, data: [{ email: 'coder@private.com', primary: true, verified: true }] },
    )

    const profile = await fetchGitHubProfile(context, customFetch)
    expect(profile).not.toBeNull()
    expect(profile?.email).toBe('coder@private.com')
    expect(profile?.email_verified).toBe(true)
  })

  it('refuses sign-in identity when primary email is unverified even if secondary email is verified', async () => {
    const customFetch = mockFetch(
      { ok: true, data: { id: 9999, login: 'multi', name: 'Multi', email: 'primary@unverified.com', avatar_url: '' } },
      {
        ok: true,
        data: [
          { email: 'primary@unverified.com', primary: true, verified: false },
          { email: 'secondary@verified.com', primary: false, verified: true },
        ],
      },
    )

    const profile = await fetchGitHubProfile(context, customFetch)
    expect(profile).not.toBeNull()
    expect(profile?.email).toBe('primary@unverified.com')
    expect(profile?.email_verified).toBe(false)
  })

  it('safely ignores invalid email record entries with missing or wrong types', async () => {
    const customFetch = mockFetch(
      { ok: true, data: { id: 7777, login: 'types', name: null, email: null, avatar_url: '' } },
      {
        ok: true,
        data: [
          null,
          'not-an-object',
          { email: 123, primary: true, verified: true },
          { email: '', primary: true, verified: true },
          { email: 'valid@example.com', primary: 'true', verified: true },
          { email: 'real@example.com', primary: true, verified: true },
        ],
      },
    )

    const profile = await fetchGitHubProfile(context, customFetch)
    expect(profile).not.toBeNull()
    expect(profile?.email).toBe('real@example.com')
    expect(profile?.email_verified).toBe(true)
  })

  it('marks email_verified as false when all GitHub emails are unverified', async () => {
    const customFetch = mockFetch(
      { ok: true, data: { id: 1111, login: 'unverified', name: 'Unverified', email: 'unverified@example.com', avatar_url: '' } },
      {
        ok: true,
        data: [
          { email: 'unverified@example.com', primary: true, verified: false },
          { email: 'other@unverified.com', primary: false, verified: false },
        ],
      },
    )

    const profile = await fetchGitHubProfile(context, customFetch)
    expect(profile).not.toBeNull()
    expect(profile?.email).toBe('unverified@example.com')
    expect(profile?.email_verified).toBe(false)
  })

  it('marks email_verified as false when emails list is empty', async () => {
    const customFetch = mockFetch(
      { ok: true, data: { id: 2222, login: 'noemails', name: null, email: null, avatar_url: '' } },
      { ok: true, data: [] },
    )

    const profile = await fetchGitHubProfile(context, customFetch)
    expect(profile).not.toBeNull()
    expect(profile?.email).toBeNull()
    expect(profile?.email_verified).toBe(false)
  })

  it('handles malformed non-array data from /user/emails safely without throwing', async () => {
    const customFetch = mockFetch(
      { ok: true, data: { id: 3333, login: 'malformed', name: null, email: 'user@example.com', avatar_url: '' } },
      { ok: true, data: { message: 'Not an array' } },
    )

    const profile = await fetchGitHubProfile(context, customFetch)
    expect(profile).not.toBeNull()
    expect(profile?.email_verified).toBe(false)
  })

  it('marks email_verified as false when /user/emails request fails', async () => {
    const customFetch = mockFetch(
      { ok: true, data: { id: 4444, login: 'fail', name: null, email: 'fake@fake.com', avatar_url: '' } },
      { ok: false },
    )

    const profile = await fetchGitHubProfile(context, customFetch)
    expect(profile).not.toBeNull()
    expect(profile?.email_verified).toBe(false)
  })

  it('returns null when /user request fails', async () => {
    const customFetch = mockFetch({ ok: false })
    const profile = await fetchGitHubProfile(context, customFetch)
    expect(profile).toBeNull()
  })

  it('returns null when tokens.access_token is missing', async () => {
    const emptyContext: GitHubUserinfoContext = {
      tokens: { access_token: undefined },
      provider: { userinfo: { url: 'https://api.github.com/user' } },
    }
    const profile = await fetchGitHubProfile(emptyContext, mockFetch({ ok: true, data: {} }))
    expect(profile).toBeNull()
  })
})

describe('isAllowedSignIn (production identity & security policy)', () => {
  const configuredEnv = {
    AUTH_GOOGLE_ID: 'google-id',
    AUTH_GOOGLE_SECRET: 'google-secret',
    AUTH_GITHUB_ID: 'github-id',
    AUTH_GITHUB_SECRET: 'github-secret',
  }

  it.each(['google', 'github'] as const)(
    'allows %s sign-in when identity holds verified email and provider is configured',
    (provider) => {
      const result = isAllowedSignIn({
        user: { email: `user@${provider}.com` },
        account: { provider },
        profile: { email_verified: true },
        env: configuredEnv,
      })
      expect(result).toBe(true)
    },
  )

  it.each(['google', 'github'] as const)(
    'refuses %s sign-in with EmailNotVerified when email is unverified',
    (provider) => {
      const result = isAllowedSignIn({
        user: { email: `unverified@${provider}.com` },
        account: { provider },
        profile: { email_verified: false },
        env: configuredEnv,
      })
      expect(result).toBe('/login?error=EmailNotVerified')
    },
  )

  it.each(['google', 'github'] as const)(
    'refuses %s sign-in with EmailNotVerified when profile.email_verified is undefined',
    (provider) => {
      const result = isAllowedSignIn({
        user: { email: `unverified@${provider}.com` },
        account: { provider },
        profile: {},
        env: configuredEnv,
      })
      expect(result).toBe('/login?error=EmailNotVerified')
    },
  )

  it('refuses sign-in if provider credentials are not configured on deployment (closes direct endpoint attack)', () => {
    const googleOnlyEnv = {
      AUTH_GOOGLE_ID: 'google-id',
      AUTH_GOOGLE_SECRET: 'google-secret',
      AUTH_GITHUB_ID: '',
      AUTH_GITHUB_SECRET: '',
    }
    // Attempting GitHub sign-in on Google-only deployment is refused outright
    const result = isAllowedSignIn({
      user: { email: 'hacker@github.com' },
      account: { provider: 'github' },
      profile: { email_verified: true },
      env: googleOnlyEnv,
    })
    expect(result).toBe(false)
  })

  it('refuses unknown provider IDs outright', () => {
    const result = isAllowedSignIn({
      user: { email: 'user@example.com' },
      account: { provider: 'gitlab' },
      profile: { email_verified: true },
      env: configuredEnv,
    })
    expect(result).toBe(false)
  })

  it('refuses sign-in when user.email is missing or empty', () => {
    expect(isAllowedSignIn({
      user: { email: null },
      account: { provider: 'github' },
      profile: { email_verified: true },
      env: configuredEnv,
    })).toBe(false)

    expect(isAllowedSignIn({
      user: { email: '' },
      account: { provider: 'github' },
      profile: { email_verified: true },
      env: configuredEnv,
    })).toBe(false)
  })

  it('refuses sign-in when account is missing', () => {
    expect(isAllowedSignIn({
      user: { email: 'user@example.com' },
      account: null,
      profile: { email_verified: true },
      env: configuredEnv,
    })).toBe(false)
  })
})
