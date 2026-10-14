import { auth } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { planRequiredFor } from '@/lib/billing/entitlements'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { LockedFeature } from '@/components/billing/locked-feature'
import { getOrgAIConfig } from '@/lib/db/queries/ai-config'
import { getDeploymentMode } from '@/lib/billing/plans'
import { getPlatformModel } from '@/lib/ai/platform-models'
import SimulationClient from './simulation-client'

export const dynamic = 'force-dynamic'

export default async function SimulationPage() {
  const session = await auth()
  const orgId = session?.orgId ?? DEFAULT_ORG_ID

  if (!(await orgHasFeature(orgId, 'simulation'))) {
    return (
      <div className="dashboard-page max-w-6xl">
        <LockedFeature requiredPlan={planRequiredFor('simulation')} featureLabel="Simulation / dry-run mode" />
      </div>
    )
  }

  // The model picker only offers models that can actually run: the org's own
  // configured provider/model if one exists. Without one, on hosted,
  // chatModel() runs only the included platform chat model (metered to the
  // workspace's included usage), so the picker is locked to it; self-hosted
  // runs the operator's .env OpenAI key with a choice of OpenAI models.
  const cfg = await getOrgAIConfig(orgId).catch(() => null)
  const hasOrgKey = !!cfg?.chat_api_key || cfg?.chat_provider === 'openai-compatible'
  const includedModel = !hasOrgKey && getDeploymentMode() === 'cloud' ? getPlatformModel('chat') : null

  return (
    <SimulationClient
      configuredProvider={hasOrgKey ? cfg!.chat_provider : null}
      configuredModel={hasOrgKey ? cfg!.chat_model : null}
      includedModel={includedModel}
    />
  )
}
