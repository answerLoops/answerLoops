import { describe, expect, it, vi } from 'vitest'
import { fetchGitHubProfile, type GitHubUserinfoContext } from '@/lib/auth/github'
import { isAllowedSignIn } from '@/lib/auth/signin'
import { getRegisteredProviders } from '@/lib/auth/providers'
import { logger } from '@/lib/logger'

describe('auth.ts — Provider registration', () => {
  it('registers both Google and GitHub when both are configured', () => {
    const env = {
      AUTH_GOOGLE_ID: 'google-id',
      AUTH_GOOGLE_SECRET: 'google-secret',
      AUTH_GITHUB_ID: 'github-id',
      AUTH_GITHUB_SECRET: 'github-secret',
    }
    const providers = getRegisteredProviders(env)
    const ids = providers.map((p) => (typeof p === 'function' ? p().id : p.id))
    expect(ids).toContain('google')
    expect(ids).toContain('github')
    expect(ids).toHaveLength(2)
  })

  it('registers only Google when only Google credentials are configured', () => {
    const env = {
      AUTH_GOOGLE_ID: 'google-id',
      AUTH_GOOGLE_SECRET: 'google-secret',
      AUTH_GITHUB_ID: '',
      AUTH_GITHUB_SECRET: '',
    }
    const providers = getRegisteredProviders(env)
    const ids = providers.map((p) => (typeof p === 'function' ? p().id : p.id))
    expect(ids).toEqual(['google'])
  })

  it('registers only GitHub when only GitHub credentials are configured', () => {
    const env = {
      AUTH_GOOGLE_ID: '',
      AUTH_GOOGLE_SECRET: '',
      AUTH_GITHUB_ID: 'github-id',
      AUTH_GITHUB_SECRET: 'github-secret',
    }
    const providers = getRegisteredProviders(env)
    const ids = providers.map((p) => (typeof p === 'function' ? p().id : p.id))
    expect(ids).toEqual(['github'])
  })

  it('registers no providers when no credentials are configured', () => {
    const env = {
      AUTH_GOOGLE_ID: '',
      AUTH_GOOGLE_SECRET: '',
      AUTH_GITHUB_ID: '',
      AUTH_GITHUB_SECRET: '',
    }
    const providers = getRegisteredProviders(env)
    expect(providers).toHaveLength(0)
  })
})

describe('fetchGitHubProfile (identity retrieval and error handling)', () => {
  const context: GitHubUserinfoContext = {
    tokens: { access_token: '<mock-access-token>' },
    provider: { userinfo: { url: 'https://api.github.com/user' } },
  }

  function mockFetch(
    userResult: { ok: boolean; status?: number; data?: unknown },
    emailsResult?: { ok: boolean; status?: number; data?: unknown },
  ): typeof fetch {
    return vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString()
      if (urlStr.includes('/user/emails')) {
        return {
          ok: emailsResult?.ok ?? false,
          status: emailsResult?.status ?? (emailsResult?.ok ? 200 : 500),
          json: async () => emailsResult?.data,
        } as unknown as Response
      }
      return {
        ok: userResult.ok,
        status: userResult.status ?? (userResult.ok ? 200 : 500),
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
    expect(profile?.api_error).toBeUndefined()
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
    expect(profile?.api_error).toBeUndefined()
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
    expect(profile?.api_error).toBeUndefined()
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

  it('marks email_verified as false when all GitHub emails are genuinely unverified', async () => {
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
    expect(profile?.api_error).toBeUndefined()
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
    expect(profile?.api_error).toBeUndefined()
  })

  it('logs failure and sets api_error when /user/emails request fails (e.g. rate limit)', async () => {
    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const customFetch = mockFetch(
      { ok: true, data: { id: 4444, login: 'ratelimited', name: null, email: 'user@example.com', avatar_url: '' } },
      { ok: false, status: 403 },
    )

    const profile = await fetchGitHubProfile(context, customFetch)
    expect(profile).not.toBeNull()
    expect(profile?.email_verified).toBe(false)
    expect(profile?.api_error).toBe(true)
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'GitHub user emails request returned non-OK status',
      expect.objectContaining({
        module: 'auth/github',
        endpoint: '/user/emails',
        status: 403,
      }),
    )
    loggerErrorSpy.mockRestore()
  })

  it('logs failure and sets api_error when /user/emails throws a network error', async () => {
    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const customFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString()
      if (urlStr.includes('/user/emails')) {
        throw new Error('Connection timeout')
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 5555, login: 'neterr', name: null, email: 'user@example.com', avatar_url: '' }),
      } as unknown as Response
    }) as unknown as typeof fetch

    const profile = await fetchGitHubProfile(context, customFetch)
    expect(profile).not.toBeNull()
    expect(profile?.email_verified).toBe(false)
    expect(profile?.api_error).toBe(true)
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'GitHub user emails request threw network error',
      expect.objectContaining({
        module: 'auth/github',
        endpoint: '/user/emails',
      }),
    )
    loggerErrorSpy.mockRestore()
  })

  it('logs failure and sets api_error when /user/emails returns malformed non-array data', async () => {
    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const customFetch = mockFetch(
      { ok: true, data: { id: 3333, login: 'malformed', name: null, email: 'user@example.com', avatar_url: '' } },
      { ok: true, data: { message: 'Not an array' } },
    )

    const profile = await fetchGitHubProfile(context, customFetch)
    expect(profile).not.toBeNull()
    expect(profile?.email_verified).toBe(false)
    expect(profile?.api_error).toBe(true)
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'GitHub user emails response was not an array',
      expect.objectContaining({
        module: 'auth/github',
        endpoint: '/user/emails',
      }),
    )
    loggerErrorSpy.mockRestore()
  })

  it('returns null and logs error when /user request fails without fabricating profile', async () => {
    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const customFetch = mockFetch({ ok: false, status: 500 })

    const profile = await fetchGitHubProfile(context, customFetch)
    expect(profile).toBeNull()
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'GitHub user profile request returned non-OK status',
      expect.objectContaining({
        module: 'auth/github',
        endpoint: '/user',
        status: 500,
      }),
    )
    loggerErrorSpy.mockRestore()
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

describe('isAllowedSignIn (provider configuration & email verification policy)', () => {
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
        account: { provider, providerAccountId: '12345' },
        profile: { email_verified: true },
        env: configuredEnv,
      })
      expect(result).toBe(true)
    },
  )

  it('surfaces GitHubApiError when profile indicates an upstream API error', () => {
    const result = isAllowedSignIn({
      user: { email: 'user@github.com' },
      account: { provider: 'github', providerAccountId: '12345' },
      profile: { email_verified: false, api_error: true },
      env: configuredEnv,
    })
    expect(result).toBe('/login?error=GitHubApiError')
  })

  it('surfaces GitHubApiError even when user.email is null due to upstream API error', () => {
    const result = isAllowedSignIn({
      user: { email: null },
      account: { provider: 'github', providerAccountId: '12345' },
      profile: { email_verified: false, api_error: true },
      env: configuredEnv,
    })
    expect(result).toBe('/login?error=GitHubApiError')
  })

  it.each(['google', 'github'] as const)(
    'refuses %s sign-in with EmailNotVerified when email is genuinely unverified',
    (provider) => {
      const result = isAllowedSignIn({
        user: { email: `unverified@${provider}.com` },
        account: { provider, providerAccountId: '12345' },
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
        account: { provider, providerAccountId: '12345' },
        profile: {},
        env: configuredEnv,
      })
      expect(result).toBe('/login?error=EmailNotVerified')
    },
  )

  it('refuses a provider that is not configured', () => {
    const googleOnlyEnv = {
      AUTH_GOOGLE_ID: 'google-id',
      AUTH_GOOGLE_SECRET: 'google-secret',
      AUTH_GITHUB_ID: '',
      AUTH_GITHUB_SECRET: '',
    }
    const result = isAllowedSignIn({
      user: { email: 'user@unconfigured.com' },
      account: { provider: 'github', providerAccountId: '12345' },
      profile: { email_verified: true },
      env: googleOnlyEnv,
    })
    expect(result).toBe(false)
  })

  it('refuses unknown provider IDs outright', () => {
    const result = isAllowedSignIn({
      user: { email: 'user@example.com' },
      account: { provider: 'gitlab', providerAccountId: '12345' },
      profile: { email_verified: true },
      env: configuredEnv,
    })
    expect(result).toBe(false)
  })

  it('refuses sign-in when user.email is missing or empty', () => {
    expect(
      isAllowedSignIn({
        user: { email: null },
        account: { provider: 'github', providerAccountId: '12345' },
        profile: { email_verified: true },
        env: configuredEnv,
      }),
    ).toBe(false)

    expect(
      isAllowedSignIn({
        user: { email: '' },
        account: { provider: 'github', providerAccountId: '12345' },
        profile: { email_verified: true },
        env: configuredEnv,
      }),
    ).toBe(false)
  })

  it('refuses sign-in when account or providerAccountId is missing', () => {
    expect(
      isAllowedSignIn({
        user: { email: 'user@example.com' },
        account: null,
        profile: { email_verified: true },
        env: configuredEnv,
      }),
    ).toBe(false)

    expect(
      isAllowedSignIn({
        user: { email: 'user@example.com' },
        account: { provider: 'github', providerAccountId: null },
        profile: { email_verified: true },
        env: configuredEnv,
      }),
    ).toBe(false)

    expect(
      isAllowedSignIn({
        user: { email: 'user@example.com' },
        account: { provider: 'github', providerAccountId: '   ' },
        profile: { email_verified: true },
        env: configuredEnv,
      }),
    ).toBe(false)
  })
})
