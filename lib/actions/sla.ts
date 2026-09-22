'use server'

import { z } from 'zod'
import { refresh } from 'next/cache'
import { updateSLAConfig } from '@/lib/db/queries/sla'
import type { Priority } from '@/types'

const UpdateSLASchema = z.object({
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  responseHours: z.coerce.number().int().min(1),
  resolveHours: z.coerce.number().int().min(1),
})

export async function updateSLAAction(
  _prevState: unknown,
  formData: FormData
): Promise<{ error?: string } | null> {
  const parsed = UpdateSLASchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'Invalid values' }

  const { priority, responseHours, resolveHours } = parsed.data
  if (resolveHours <= responseHours) {
    return { error: 'Resolve time must be greater than response time' }
  }

  updateSLAConfig(priority as Priority, responseHours, resolveHours)
  refresh()
  return null
}
