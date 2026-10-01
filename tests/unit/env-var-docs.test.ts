import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Guards that newly-introduced env vars stay documented. Per this repo's
// infra-test convention, new env vars get a simple string-presence check
// against the docs file(s) they're supposed to live in — not a full parse of
// the mdx table. This currently covers DEPLOYMENT_MODE, added to gate
// plan-tier billing/entitlements between answerLoops' managed cloud
// deployment and self-hosted installs (see lib/billing/entitlements-server.ts
// getDeploymentMode() — covered in depth by entitlements.test.ts and
// metering-reservation.test.ts; this file only checks the docs stayed in sync).

const ROOT = process.cwd()

function readDoc(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `Docs file not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('DEPLOYMENT_MODE env var is documented', () => {
  it('is referenced in content/docs/reference/environment-variables.mdx', () => {
    const doc = readDoc('content/docs/reference/environment-variables.mdx')
    expect(doc).toContain('DEPLOYMENT_MODE')
  })

  it('is referenced in content/docs/self-hosting/environment-variables.mdx', () => {
    const doc = readDoc('content/docs/self-hosting/environment-variables.mdx')
    expect(doc).toContain('DEPLOYMENT_MODE')
  })
})

// RESEND_NEWSLETTER_FROM, added for the blog newsletter signup confirmation
// email (lib/email/send.ts sendNewsletterConfirmation), falls back to
// RESEND_FROM so it's optional in practice — but an optional var that's
// silently missing from .env.example is still a real gap: a self-hoster
// copying .env.example as their starting point would never discover the var
// exists. Checked against the local .env.example as well as both docs
// tables, since .env.example isn't covered by the DEPLOYMENT_MODE checks above.
describe('RESEND_NEWSLETTER_FROM env var is documented', () => {
  it('is present (even if blank) in .env.example', () => {
    const envExample = readDoc('.env.example')
    expect(envExample).toMatch(/^RESEND_NEWSLETTER_FROM=/m)
  })

  it('is referenced in content/docs/reference/environment-variables.mdx', () => {
    const doc = readDoc('content/docs/reference/environment-variables.mdx')
    expect(doc).toContain('RESEND_NEWSLETTER_FROM')
  })

  it('is referenced in content/docs/self-hosting/environment-variables.mdx', () => {
    const doc = readDoc('content/docs/self-hosting/environment-variables.mdx')
    expect(doc).toContain('RESEND_NEWSLETTER_FROM')
  })
})
