import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { STRIPE_FAILURE_STATUS } from '@/lib/billing/http-status'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')

describe('billing failure status', () => {
  it('is a plain 500, because Cloudflare replaces origin 502 and 504 bodies with its own page', () => {
    expect(STRIPE_FAILURE_STATUS).toBe(500)
  })

  it.each(['lib/billing/checkout.ts', 'app/api/billing/portal/route.ts', 'app/api/billing/checkout/embedded/route.ts', 'app/api/billing/checkout/route.ts'])(
    '%s never answers with a status the edge would mask',
    (file) => {
      expect(read(file)).not.toMatch(/status:\s*50[24]\b/)
    },
  )
})
