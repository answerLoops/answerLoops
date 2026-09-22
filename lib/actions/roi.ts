'use server'

import { z } from 'zod'
import { auth } from '@/auth'
import { saveOrgROIConfig } from '@/lib/db/queries/orgs'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { revalidatePath } from 'next/cache'

const schema = z.object({
  minutesPerTicket: z.coerce.number().int().min(1).max(480),
  staffHourlyRate: z.coerce.number().int().min(1).max(10000),
})

export async function saveROIConfigAction(_: unknown, formData: FormData) {
  const session = await auth()
  const orgId = (session as { orgId?: number }).orgId ?? DEFAULT_ORG_ID

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
