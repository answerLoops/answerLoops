'use server'

import { z } from 'zod'
import { requireOrgAccess } from '@/lib/auth/org'
import {
  getSupportSettings,
  updateSupportSettings,
  MAX_DAILY_LIMIT,
  SupportSettingsError,
  type SupportSettings,
} from '@/lib/db/queries/kb-support'
import { logger } from '@/lib/logger'

const MOD = 'actions/source-support'

// Which answers are assessed, and whether evidence text is kept, are workspace
// decisions about cost and stored text: owners and admins only, the same gate
// as the answer-source records they build on.
const SOURCE_SUPPORT_ROLES = ['owner', 'admin'] as const

export type SourceSupportResult = { settings: SupportSettings; error?: undefined } | { error: string; settings?: undefined }

export async function getSourceSupportSettingsAction(): Promise<SourceSupportResult> {
  const access = await requireOrgAccess(SOURCE_SUPPORT_ROLES)
  if (!access.ok) return { error: access.error }
  return { settings: await getSupportSettings(access.orgId) }
}

/** An empty box means unset, which assesses nothing. */
const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess((v) => (v === null || v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v), z.coerce.number().pipe(schema).nullable())

const formSchema = z.object({
  samplingPercent: optionalNumber(
    z.number({ error: 'Enter the share of answers as a number from 0 to 100' })
      .min(0, 'The share of answers must be from 0 to 100')
      .max(100, 'The share of answers must be from 0 to 100')
  ),
  dailyLimit: optionalNumber(
    z.number({ error: 'Enter the daily limit as a whole number' })
      .int('The daily limit must be a whole number')
      .min(0, `The daily limit must be from 0 to ${MAX_DAILY_LIMIT.toLocaleString('en-US')}`)
      .max(MAX_DAILY_LIMIT, `The daily limit must be from 0 to ${MAX_DAILY_LIMIT.toLocaleString('en-US')}`)
  ),
})

/** A checkbox is on when the form sends it at all; an unchecked box sends nothing. */
const checked = (formData: FormData, name: string) => {
  const value = formData.get(name)
  return value === 'on' || value === 'true'
}

/**
 * Saves the whole source-support form at once: the four channel switches, the
 * sampling rate (entered as a percentage), the daily limit and the separate
 * excerpt-storage opt-in. Out-of-range values are refused, never clamped.
 */
export async function saveSourceSupportSettingsAction(_prev: unknown, formData: FormData): Promise<SourceSupportResult> {
  const access = await requireOrgAccess(SOURCE_SUPPORT_ROLES)
  if (!access.ok) return { error: access.error }

  const parsed = formSchema.safeParse({
    samplingPercent: formData.get('samplingPercent'),
    dailyLimit: formData.get('dailyLimit'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the values and try again' }

  const { samplingPercent, dailyLimit } = parsed.data
  const patch: SupportSettings = {
    widgetEnabled: checked(formData, 'widgetEnabled'),
    ticketEnabled: checked(formData, 'ticketEnabled'),
    discordEnabled: checked(formData, 'discordEnabled'),
    agentApiEnabled: checked(formData, 'agentApiEnabled'),
    // Stored as 0..1; rounded so 33.3% does not become 0.33299999.
    samplingRate: samplingPercent === null ? null : Math.round(samplingPercent * 100) / 10_000,
    dailyLimit,
    excerptStorageEnabled: checked(formData, 'excerptStorageEnabled'),
  }

  try {
    return { settings: await updateSupportSettings(access.orgId, patch, access.userId) }
  } catch (err) {
    if (err instanceof SupportSettingsError) return { error: err.message }
    logger.error('saving source support settings failed', { module: MOD, orgId: access.orgId, error: err })
    return { error: 'The settings could not be saved. Try again.' }
  }
}
