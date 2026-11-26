import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientIp } from '@/lib/http/client-ip'

function req(headers: Record<string, string>) {
  return { headers: new Headers(headers) }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('clientIp cf-connecting-ip trust', () => {
  it('is honoured in development without a verify secret', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ORIGIN_VERIFY_SECRET', '')
    expect(clientIp(req({ 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '198.51.100.1' }))).toBe(
      '203.0.113.5'
    )
  })

  it('is honoured in self-hosted production only when the operator opts in', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DEPLOYMENT_MODE', 'self-hosted')
    vi.stubEnv('ORIGIN_VERIFY_SECRET', '')
    vi.stubEnv('TRUST_PROXY_HOPS', '1')
    const headers = { 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': 'spoofed, 198.51.100.1' }

    vi.stubEnv('TRUST_CLOUDFLARE_IP_HEADER', '')
    expect(clientIp(req(headers))).toBe('198.51.100.1')
    vi.stubEnv('TRUST_CLOUDFLARE_IP_HEADER', 'yes')
    expect(clientIp(req(headers))).toBe('198.51.100.1')
    vi.stubEnv('TRUST_CLOUDFLARE_IP_HEADER', 'true')
    expect(clientIp(req(headers))).toBe('203.0.113.5')
  })

  it('is never honoured in managed-cloud production by the opt-in alone', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('ORIGIN_VERIFY_SECRET', '')
    vi.stubEnv('TRUST_CLOUDFLARE_IP_HEADER', 'true')
    vi.stubEnv('TRUST_PROXY_HOPS', '1')
    expect(clientIp(req({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': 'spoofed, 198.51.100.1' }))).toBe(
      '198.51.100.1'
    )
  })

  it('is ignored in managed-cloud production unless the origin check passed', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('ORIGIN_VERIFY_SECRET', '')
    vi.stubEnv('TRUST_PROXY_HOPS', '1')
    expect(
      clientIp(req({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': 'spoofed, 198.51.100.1' }))
    ).toBe('198.51.100.1')
  })

  it('with a secret configured, requires the matching edge header', () => {
    vi.stubEnv('ORIGIN_VERIFY_SECRET', '<edge-secret>')
    const base = { 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': 'spoofed, 198.51.100.1' }
    expect(clientIp(req(base))).toBe('198.51.100.1')
    expect(clientIp(req({ ...base, 'x-origin-verify': 'wrong' }))).toBe('198.51.100.1')
    expect(clientIp(req({ ...base, 'x-origin-verify': '<edge-secret>' }))).toBe('203.0.113.5')
  })

  it('reads the self-hosted opt-in without regard to case or surrounding spaces', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DEPLOYMENT_MODE', 'self-hosted')
    vi.stubEnv('ORIGIN_VERIFY_SECRET', '')
    vi.stubEnv('TRUST_PROXY_HOPS', '1')
    vi.stubEnv('TRUST_CLOUDFLARE_IP_HEADER', ' TRUE ')
    expect(clientIp(req({ 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': 'spoofed, 198.51.100.1' }))).toBe(
      '203.0.113.5'
    )
  })

  it('with a secret configured, the self-hosted opt-in does not replace the edge header check', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DEPLOYMENT_MODE', 'self-hosted')
    vi.stubEnv('ORIGIN_VERIFY_SECRET', '<edge-secret>')
    vi.stubEnv('TRUST_CLOUDFLARE_IP_HEADER', 'true')
    vi.stubEnv('TRUST_PROXY_HOPS', '1')
    const base = { 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': 'spoofed, 198.51.100.1' }
    expect(clientIp(req(base))).toBe('198.51.100.1')
    expect(clientIp(req({ ...base, 'x-origin-verify': '<edge-secret>' }))).toBe('203.0.113.5')
  })
})
