import { describe, expect, it } from 'vitest'
import nextConfig from '@/next.config'

describe('development asset caching', () => {
  it('leaves static chunk cache policy to Next.js', async () => {
    const rules = await nextConfig.headers?.()
    for (const rule of rules ?? []) {
      const matchesAsset = new RegExp(`^${rule.source}$`).test('/_next/static/chunks/components_marketing.css')
      if (!matchesAsset) continue
      expect(rule.headers.filter(({ key }) => key.toLowerCase() === 'cache-control')).toEqual([])
    }
  })
})
