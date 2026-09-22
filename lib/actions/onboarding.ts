'use server'

import { z } from 'zod'
import { auth, unstable_update } from '@/auth'
import { updateOrgName, setOrgOnboarded } from '@/lib/db/queries/orgs'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'

const NameSchema = z.object({
  name: z.string().min(1, 'Workspace name is required').max(80),
})

export async function updateWorkspaceNameAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const session = await auth()
  if (!session?.user) return { error: 'Unauthorized' }
  const orgId = session.orgId ?? DEFAULT_ORG_ID

  const parsed = NameSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  await updateOrgName(orgId, parsed.data.name)
  return null
}

// Called directly from a client onClick handler (not a <form action>), so
// redirect()'s throw-based navigation never reaches the browser — it's
// only intercepted when Next dispatches the action itself. Return a plain
// result instead and let the caller navigate with router.push.
export async function completeOnboardingAction(): Promise<{ error?: string } | null> {
  const session = await auth()
  if (!session?.user) return { error: 'Unauthorized' }
  const orgId = session.orgId ?? DEFAULT_ORG_ID

  await setOrgOnboarded(orgId)
  // Stamp the JWT so a future DB wipe won't force the user back through onboarding.
  await unstable_update({ onboarded: true })
  return null
}
