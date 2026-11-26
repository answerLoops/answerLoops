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
})

// AUTH_SESSION_IDLE_HOURS, added for the dashboard sign-in idle timeout
// (lib/auth/session-lifetime.ts, wired into auth.ts session.maxAge). The
// parsing and config wiring are covered by session-idle-lifetime.test.ts; this
// checks that the numbers the docs quote stay equal to the constants the code
// enforces, so changing the default or the range without the docs fails here.
describe('AUTH_SESSION_IDLE_HOURS env var is documented', async () => {
  const {
    DEFAULT_SESSION_IDLE_HOURS,
    MIN_SESSION_IDLE_HOURS,
    MAX_SESSION_IDLE_HOURS,
    SESSION_IDLE_HOURS_ENV,
  } = await import('@/lib/auth/session-lifetime')

  function envVarRow(): string {
    const doc = readDoc('content/docs/reference/environment-variables.mdx')
    const row = doc
      .split('\n')
      .find((line) => line.startsWith(`| \`${SESSION_IDLE_HOURS_ENV}\` |`))
    expect(row, `${SESSION_IDLE_HOURS_ENV} has no table row`).toBeDefined()
    return row as string
  }

  it('has a table row in content/docs/reference/environment-variables.mdx', () => {
    expect(SESSION_IDLE_HOURS_ENV).toBe('AUTH_SESSION_IDLE_HOURS')
    envVarRow()
  })

  it('quotes the same default as DEFAULT_SESSION_IDLE_HOURS', () => {
    expect(envVarRow()).toContain(`Defaults to \`${DEFAULT_SESSION_IDLE_HOURS}\``)
  })

  it('quotes the same range as MIN_ and MAX_SESSION_IDLE_HOURS', () => {
    expect(envVarRow()).toContain(
      `from ${MIN_SESSION_IDLE_HOURS} to ${MAX_SESSION_IDLE_HOURS}`,
    )
  })

  it('is described in content/docs/product/team.mdx with the same default hours', () => {
    const doc = readDoc('content/docs/product/team.mdx')
    expect(doc).toContain(`after ${DEFAULT_SESSION_IDLE_HOURS} hours without activity`)
    expect(doc).toContain(`\`${SESSION_IDLE_HOURS_ENV}\``)
  })
})
