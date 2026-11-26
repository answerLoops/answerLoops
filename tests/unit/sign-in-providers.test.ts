import { describe, expect, it } from 'vitest'
import { configuredSignInProviders, parseSignInProvider } from '@/lib/auth/providers'

const google = { AUTH_GOOGLE_ID: 'google-id', AUTH_GOOGLE_SECRET: 'google-secret' }
const github = { AUTH_GITHUB_ID: 'github-id', AUTH_GITHUB_SECRET: 'github-secret' }
const both = { ...google, ...github }

describe('configuredSignInProviders', () => {
  it('lists a method only when every credential it needs is set', () => {
    expect(configuredSignInProviders(google)).toEqual([{ id: 'google', label: 'Google' }])
    expect(configuredSignInProviders(github)).toEqual([{ id: 'github', label: 'GitHub' }])
    expect(configuredSignInProviders(both)).toEqual([
      { id: 'google', label: 'Google' },
      { id: 'github', label: 'GitHub' },
    ])
    expect(configuredSignInProviders({ AUTH_GOOGLE_ID: 'id' })).toEqual([])
    expect(configuredSignInProviders({ AUTH_GOOGLE_SECRET: 'secret' })).toEqual([])
    expect(configuredSignInProviders({ AUTH_GITHUB_ID: 'id' })).toEqual([])
    expect(configuredSignInProviders({ AUTH_GITHUB_SECRET: 'secret' })).toEqual([])
    expect(configuredSignInProviders({})).toEqual([])
  })

  it('treats empty or whitespace-only values as not configured', () => {
    expect(configuredSignInProviders({ AUTH_GOOGLE_ID: '', AUTH_GOOGLE_SECRET: 'secret' })).toEqual([])
    expect(configuredSignInProviders({ AUTH_GOOGLE_ID: '  ', AUTH_GOOGLE_SECRET: 'secret' })).toEqual([])
    expect(configuredSignInProviders({ AUTH_GITHUB_ID: '', AUTH_GITHUB_SECRET: 'secret' })).toEqual([])
    expect(configuredSignInProviders({ AUTH_GITHUB_ID: '  ', AUTH_GITHUB_SECRET: 'secret' })).toEqual([])
  })

  it('preserves provider ordering (Google first, GitHub second)', () => {
    const providers = configuredSignInProviders(both)
    expect(providers.map((p) => p.id)).toEqual(['google', 'github'])
  })

  it('does not leak the credential requirements to callers', () => {
    expect(Object.keys(configuredSignInProviders(google)[0]).sort()).toEqual(['id', 'label'])
    expect(Object.keys(configuredSignInProviders(github)[0]).sort()).toEqual(['id', 'label'])
  })
})

describe('parseSignInProvider', () => {
  it('accepts a configured method', () => {
    expect(parseSignInProvider('google', google)).toBe('google')
    expect(parseSignInProvider('github', github)).toBe('github')
    expect(parseSignInProvider('google', both)).toBe('google')
    expect(parseSignInProvider('github', both)).toBe('github')
  })

  it('rejects a method that is known but not configured', () => {
    expect(parseSignInProvider('google', {})).toBeNull()
    expect(parseSignInProvider('github', {})).toBeNull()
    expect(parseSignInProvider('github', google)).toBeNull()
    expect(parseSignInProvider('google', github)).toBeNull()
  })

  it.each(['gitlab', 'discord', 'GOOGLE', 'GITHUB', '', ' github', 'github;', '__proto__', 'toString', 123, true, {}, []])('rejects %j', (value) => {
    expect(parseSignInProvider(value, both)).toBeNull()
  })

  it('rejects missing values', () => {
    expect(parseSignInProvider(null, both)).toBeNull()
    expect(parseSignInProvider(undefined, both)).toBeNull()
  })
})
