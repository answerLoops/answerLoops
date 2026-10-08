import { describe, it, expect, afterEach } from 'vitest'
import {
  hasFeature,
  planIncludesFeature,
  planRequiredFor,
  rateLimitPerMinute,
  type Feature,
} from '@/lib/billing/entitlements'
import { PLANS, getPlan, hasActiveAccess, type PlanId } from '@/lib/billing/plans'

const ALL_FEATURES: Feature[] = [
  'discord_integration',
  'slack_integration',
  'csat_scoring',
  'human_escalation',
  'simulation',
  'knowledge_gap_dashboard',
  'custom_ai_model_config',
  'csv_export',
  'white_label_widget',
]

afterEach(() => {
  delete process.env.DEPLOYMENT_MODE
})

describe('hasFeature on cloud (DEPLOYMENT_MODE=cloud)', () => {
  it('standard unlocks discord, slack, and csv export only', () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    expect(hasFeature('standard', 'discord_integration')).toBe(true)
    expect(hasFeature('standard', 'slack_integration')).toBe(true)
    expect(hasFeature('standard', 'csv_export')).toBe(true)
    expect(hasFeature('standard', 'csat_scoring')).toBe(false)
    expect(hasFeature('standard', 'simulation')).toBe(false)
    expect(hasFeature('standard', 'custom_ai_model_config')).toBe(false)
  })

  it('standard cannot turn widget branding off; pro and enterprise can', () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    expect(hasFeature('standard', 'white_label_widget')).toBe(false)
    expect(hasFeature('pro', 'white_label_widget')).toBe(true)
    expect(hasFeature('enterprise', 'white_label_widget')).toBe(true)
    expect(planRequiredFor('white_label_widget')).toBe('pro')
  })

  it('self-hosted keeps white_label_widget unlocked on every plan', () => {
    delete process.env.DEPLOYMENT_MODE
    for (const planId of ['standard', 'pro', 'enterprise'] as PlanId[]) {
      expect(hasFeature(planId, 'white_label_widget')).toBe(true)
    }
  })

  it('pro unlocks everything standard has plus csat/escalation/simulation/knowledge-gaps', () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    for (const f of ['discord_integration', 'slack_integration', 'csv_export', 'csat_scoring', 'human_escalation', 'simulation', 'knowledge_gap_dashboard'] as Feature[]) {
      expect(hasFeature('pro', f)).toBe(true)
    }
    expect(hasFeature('pro', 'custom_ai_model_config')).toBe(false)
  })

  it('enterprise unlocks every feature', () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    for (const f of ALL_FEATURES) expect(hasFeature('enterprise', f)).toBe(true)
  })

  it('an unrecognized planId unlocks nothing', () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    for (const f of ALL_FEATURES) expect(hasFeature('not-a-real-plan', f)).toBe(false)
  })
})

describe('hasFeature on self-hosted', () => {
  it('unlocks every feature on every plan when DEPLOYMENT_MODE is unset', () => {
    delete process.env.DEPLOYMENT_MODE
    for (const planId of ['standard', 'pro', 'enterprise'] as PlanId[]) {
      for (const f of ALL_FEATURES) expect(hasFeature(planId, f)).toBe(true)
    }
  })

  it('unlocks everything even for an unrecognized planId', () => {
    delete process.env.DEPLOYMENT_MODE
    for (const f of ALL_FEATURES) expect(hasFeature('not-a-real-plan', f)).toBe(true)
  })
})

describe('planIncludesFeature — pure, no env access, used client-side against a resolved planId', () => {
  it('treats the literal planId "self-hosted" as always unlocked', () => {
    for (const f of ALL_FEATURES) expect(planIncludesFeature('self-hosted', f)).toBe(true)
  })

  it('gates a real plan id the same way hasFeature does on cloud', () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    for (const planId of ['standard', 'pro', 'enterprise'] as PlanId[]) {
      for (const f of ALL_FEATURES) {
        expect(planIncludesFeature(planId, f)).toBe(hasFeature(planId, f))
      }
    }
  })

  it('ignores DEPLOYMENT_MODE entirely — same result whether set or not', () => {
    delete process.env.DEPLOYMENT_MODE
    const unset = ALL_FEATURES.map((f) => planIncludesFeature('standard', f))
    process.env.DEPLOYMENT_MODE = 'cloud'
    const cloud = ALL_FEATURES.map((f) => planIncludesFeature('standard', f))
    expect(unset).toEqual(cloud)
  })
})

describe('planRequiredFor', () => {
  it('returns the lowest plan that unlocks each feature', () => {
    expect(planRequiredFor('discord_integration')).toBe('standard')
    expect(planRequiredFor('slack_integration')).toBe('standard')
    expect(planRequiredFor('csv_export')).toBe('standard')
    expect(planRequiredFor('csat_scoring')).toBe('pro')
    expect(planRequiredFor('human_escalation')).toBe('pro')
    expect(planRequiredFor('simulation')).toBe('pro')
    expect(planRequiredFor('knowledge_gap_dashboard')).toBe('pro')
    expect(planRequiredFor('custom_ai_model_config')).toBe('enterprise')
  })

  it('every feature is actually unlocked by the plan it names, on cloud', () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    for (const f of ALL_FEATURES) {
      const requiredPlan = planRequiredFor(f)
      expect(hasFeature(requiredPlan, f)).toBe(true)
      expect(PLANS[requiredPlan]).toBeDefined()
    }
  })
})

describe('rateLimitPerMinute — the enforced MCP/Agent API ceiling, not a marketing-only claim', () => {
  it('gives Standard a 50/min floor', () => {
    expect(rateLimitPerMinute('standard')).toBe(50)
  })

  it('gives Pro a real step up from Standard', () => {
    expect(rateLimitPerMinute('pro')).toBe(150)
    expect(rateLimitPerMinute('pro')).toBeGreaterThan(rateLimitPerMinute('standard'))
  })

  it('gives enterprise the highest ceiling, held conservatively at 300 pending the load-test roadmap item', () => {
    expect(rateLimitPerMinute('enterprise')).toBe(300)
    expect(rateLimitPerMinute('enterprise')).toBeGreaterThan(rateLimitPerMinute('pro'))
  })

  it('denies rate limit entirely for an unrecognized planId — no free-tier floor to fall back to', () => {
    expect(rateLimitPerMinute('not-a-real-plan')).toBe(0)
  })
})

describe('getPlan — no free tier, no fallback plan', () => {
  it('resolves each real PlanId to its own Plan', () => {
    for (const planId of ['standard', 'pro', 'enterprise'] as PlanId[]) {
      expect(getPlan(planId)).toEqual(PLANS[planId])
    }
  })

  it('returns null for a missing/undefined/unrecognized id — not a free plan', () => {
    expect(getPlan(undefined)).toBeNull()
    expect(getPlan(null)).toBeNull()
    expect(getPlan('hobby')).toBeNull()
    expect(getPlan('not-a-real-plan')).toBeNull()
  })
})

describe('hasActiveAccess — status gate, independent of which plan a row names', () => {
  it('grants access for active, trialing, and past_due (dunning grace)', () => {
    expect(hasActiveAccess('active')).toBe(true)
    expect(hasActiveAccess('trialing')).toBe(true)
    expect(hasActiveAccess('past_due')).toBe(true)
  })

  it('denies access for canceled, unpaid, incomplete states, and no status at all', () => {
    expect(hasActiveAccess('canceled')).toBe(false)
    expect(hasActiveAccess('unpaid')).toBe(false)
    expect(hasActiveAccess('incomplete_expired')).toBe(false)
    expect(hasActiveAccess(null)).toBe(false)
    expect(hasActiveAccess(undefined)).toBe(false)
  })
})
