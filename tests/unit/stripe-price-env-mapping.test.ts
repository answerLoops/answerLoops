import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Each plan must read STRIPE_PRICE_<its own id>.
 *
 * This drifted once and was live in production. The 2026-07-29 rename
 * (pro→standard, scale→pro) deliberately left the old env var names alone,
 * reasoning that a var name is only a label on an opaque Stripe id. Deployments
 * were then configured from the plan names instead, so the code read
 * STRIPE_PRICE_PRO for the Standard plan while the environment had that var set
 * to the Pro price. Standard billed the wrong amount, and Pro read an unset
 * STRIPE_PRICE_SCALE and returned "No Stripe price for this plan" at checkout.
 *
 * Neither failure surfaces until a customer hits it: the price shown in the app
 * comes from `priceMonthly` in the code, and the amount charged comes from the
 * Stripe Price object. Nothing reconciles the two at runtime.
 */

const PLAN_IDS = ['standard', 'pro', 'enterprise'] as const

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('each plan resolves the env var matching its own id', () => {
  it.each(PLAN_IDS)('%s reads STRIPE_PRICE_<own id>', async (planId) => {
    // A distinct sentinel per var, so a plan reading a sibling's var fails with
    // an obvious mismatch rather than coincidentally passing.
    for (const id of PLAN_IDS) {
      process.env[`STRIPE_PRICE_${id.toUpperCase()}`] = `price_sentinel_${id}`
    }

    const { PLANS } = await import('@/lib/billing/plans')

    expect(
      PLANS[planId].stripePriceId,
      `plan "${planId}" is not reading STRIPE_PRICE_${planId.toUpperCase()} — ` +
        `it resolved to ${PLANS[planId].stripePriceId}, which belongs to a different plan. ` +
        `That bills the wrong amount for one plan and breaks checkout for another.`,
    ).toBe(`price_sentinel_${planId}`)
  })

  it('every plan is unpurchasable-but-explicit when its var is unset', async () => {
    for (const id of PLAN_IDS) delete process.env[`STRIPE_PRICE_${id.toUpperCase()}`]

    const { PLANS } = await import('@/lib/billing/plans')

    // null rather than undefined or a stale fallback: checkout returns an
    // explicit 400 on null, which is the correct failure for a plan that has no
    // configured price.
    for (const id of PLAN_IDS) expect(PLANS[id].stripePriceId).toBeNull()
  })

  it('no plan reads a var for a plan that no longer exists', () => {
    // 'scale' and the old 'pro'-means-Standard mapping are both gone. A
    // reference to a retired name is how this broke: the var was simply never
    // set in any environment, so the plan silently had no price.
    //
    // Each plan now reads two vars, STRIPE_PRICE_<ID> and STRIPE_PRICE_<ID>_ANNUAL.
    // The suffix is stripped before checking, so the guarantee is unchanged:
    // every price var names a plan that currently exists.
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/billing/plans.ts'), 'utf-8')
    const referenced = [...src.matchAll(/process\.env\.STRIPE_PRICE_([A-Z_]+)/g)].map((m) =>
      m[1].toLowerCase(),
    )

    // Two per plan, and no more: an extra var means a price nothing resolves.
    expect(referenced.length).toBe(PLAN_IDS.length * 2)

    for (const name of referenced) {
      const planId = name.replace(/_annual$/, '')
      expect(
        PLAN_IDS as readonly string[],
        `plans.ts reads STRIPE_PRICE_${name.toUpperCase()}, which is not a current plan id`,
      ).toContain(planId)
    }

    // Every plan has both, so neither interval can be silently unconfigured.
    for (const id of PLAN_IDS) {
      expect(referenced, `${id} is missing a monthly price var`).toContain(id)
      expect(referenced, `${id} is missing an annual price var`).toContain(`${id}_annual`)
    }
  })
})

describe('documented env vars match what the code reads', () => {
  // The docs are how a deployment gets configured, so a var named in the code
  // but absent from the docs produces exactly this bug in the next environment.
  // .env.example is deliberately NOT one of these: it's the self-hosting
  // quick-start template, and Stripe/billing vars are cloud-platform-only —
  // a self-hoster never sets them. content/docs/reference/environment-variables.mdx
  // is the canonical reference for every variable, self-hosted or not.
  const docs = [
    'content/docs/reference/environment-variables.mdx',
  ]

  it.each(docs)('%s names the vars the code actually reads', (docPath) => {
    const doc = fs.readFileSync(path.join(process.cwd(), docPath), 'utf-8')
    for (const id of PLAN_IDS) {
      expect(doc, `${docPath} does not mention STRIPE_PRICE_${id.toUpperCase()}`).toContain(
        `STRIPE_PRICE_${id.toUpperCase()}`,
      )
    }
    expect(doc, `${docPath} still documents the retired STRIPE_PRICE_SCALE`).not.toContain(
      'STRIPE_PRICE_SCALE',
    )
  })

  it('.env.example never lists a variable that no code path reads', () => {
    // The inverse of the check above: a var here that nothing reads doesn't
    // just rot, it invites a self-hoster to fill in a working credential (a
    // real Discord OAuth app, say) for a provider that quietly does nothing.
    const example = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf-8')
    const names = [...example.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(20)

    for (const name of ['AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET', 'AUTH_GITHUB_ID', 'AUTH_GITHUB_SECRET']) {
      expect(names, `${name} is a supported sign-in method and must be in .env.example`).toContain(name)
    }

    // Not an exhaustive reverse-check of every source file — that belongs to
    // a wider repo-scan test, if one is ever written. This guards the two
    // failure modes already seen once each: a dead OAuth provider var, and a
    // renamed-but-not-removed Stripe price var.
    for (const name of ['AUTH_DISCORD_ID', 'AUTH_DISCORD_SECRET', 'DISCORD_CLIENT_SECRET', 'STRIPE_PRICE_SCALE']) {
      expect(names, `${name} is listed but no sign-in provider or billing path reads it`).not.toContain(name)
    }
  })
})
