import { describe, expect, it } from 'vitest'
import { configuredSignInProviders, parseSignInProvider } from '@/lib/auth/providers'

const google = { AUTH_GOOGLE_ID: 'id', AUTH_GOOGLE_SECRET: 'secret' }

describe('configuredSignInProviders', () => {
  it('lists a method only when every credential it needs is set', () => {
    expect(configuredSignInProviders(google)).toEqual([{ id: 'google', label: 'Google' }])
    expect(configuredSignInProviders({ AUTH_GOOGLE_ID: 'id' })).toEqual([])
    expect(configuredSignInProviders({ AUTH_GOOGLE_SECRET: 'secret' })).toEqual([])
    expect(configuredSignInProviders({})).toEqual([])
  })

  it('treats empty or whitespace-only values as not configured', () => {
    expect(configuredSignInProviders({ AUTH_GOOGLE_ID: '', AUTH_GOOGLE_SECRET: 'secret' })).toEqual([])
    expect(configuredSignInProviders({ AUTH_GOOGLE_ID: '  ', AUTH_GOOGLE_SECRET: 'secret' })).toEqual([])
  })

  it('does not leak the credential requirements to callers', () => {
    expect(Object.keys(configuredSignInProviders(google)[0]).sort()).toEqual(['id', 'label'])
  })
})

describe('parseSignInProvider', () => {
  it('accepts a configured method', () => {
    expect(parseSignInProvider('google', google)).toBe('google')
  })

  it('rejects a method that is known but not configured', () => {
    expect(parseSignInProvider('google', {})).toBeNull()
  })

  it.each(['github', 'GOOGLE', '', ' google', 'google;', '__proto__'])('rejects %j', (value) => {
    expect(parseSignInProvider(value, google)).toBeNull()
  })

  it('rejects missing values', () => {
    expect(parseSignInProvider(null, google)).toBeNull()
    expect(parseSignInProvider(undefined, google)).toBeNull()
  })
})
