'use server'

import { z } from 'zod'
import { requireOrgAccess } from '@/lib/auth/org'
import { saveOrgROIConfig } from '@/lib/db/queries/orgs'
import { revalidatePath } from 'next/cache'

const schema = z.object({
  minutesPerTicket: z.coerce.number().int().min(1).max(480),
  staffHourlyRate: z.coerce.number().int().min(1).max(10000),
})

export async function saveROIConfigAction(_: unknown, formData: FormData) {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  const parsed = schema.safeParse({
    minutesPerTicket: formData.get('minutesPerTicket'),
    staffHourlyRate: formData.get('staffHourlyRate'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid values' }
  }

  await saveOrgROIConfig(orgId, parsed.data.minutesPerTicket, parsed.data.staffHourlyRate)
  revalidatePath('/analytics')
  return { success: true }
}
