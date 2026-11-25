'use server'

import { requireOrgAccess } from '@/lib/auth/org'
import {
  ensureWidgetToken,
  rotateWidgetToken,
  setWidgetAllowedOrigins,
  getWidgetAllowedOrigins,
  getWidgetLeadCaptureMode,
  setWidgetLeadCaptureMode,
  getWidgetAnswerSettings,
  setWidgetAnswerScope,
  setWidgetGuidance,
  getWidgetSlug,
  setWidgetSlug,
  getWidgetAppearance,
  setWidgetAppearance,
} from '@/lib/db/queries/widgets'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { deleteWidgetLogo, getWidgetLogoVersion } from '@/lib/db/queries/widget-logos'
import { widgetLogoPath } from '@/lib/widget/logo'
import {
  normalizeBrandColor,
  normalizeStarterQuestions,
  normalizeWidgetTitle,
  readFollowUpsEnabled,
  readStarterEnabled,
  normalizeWidgetWelcome,
  type WidgetAppearance,
} from '@/lib/widget/appearance'
import { parseAllowedOrigins } from '@/lib/widget/origin'
import { isWidgetLeadCaptureMode, type WidgetLeadCaptureMode } from '@/lib/widget/lead-capture'
import {
  isWidgetAnswerScope,
  normalizeWidgetGuidance,
  type WidgetAnswerScope,
} from '@/lib/widget/answer-scope'

// Restricting where the widget may be embedded, and rotating the token that
// makes it work, are both configuration that breaks live embeds when set
// wrong. Same class of decision as minting an API key, so the same gate.
const WIDGET_ADMIN_ROLES = ['owner', 'admin'] as const

interface WidgetTokenResult {
  token?: string
  expiresAt?: string
  /** Newline-separated allowlist as stored; empty means unrestricted. */
  allowedOrigins?: string
  /** Whether the viewer may rotate the token or change the allowlist. */
  canManage?: boolean
  leadCaptureMode?: WidgetLeadCaptureMode
  /** What the widget may answer from. See lib/widget/answer-scope.ts. */
  answerScope?: WidgetAnswerScope
  /** The owner's note on tone and next steps, or null. */
  guidance?: string | null
  /** The public slug the embed snippet can use instead of the token, if set. */
  slug?: string | null
  /** Title, welcome message and brand color the owner chose; each null for the default. */
  appearance?: WidgetAppearance
  /** Whether the plan includes widget customization (Pro and above). */
  customizationAvailable?: boolean
  /** The address of the workspace's logo, or null. Only given while the plan includes customization. */
  logoUrl?: string | null
  error?: string
}

// Rotating a widget token immediately invalidates the live one and breaks every
// page it is embedded on, so these resolve the org from a verified membership
// row rather than trusting the session. The previous `session.orgId ??
// DEFAULT_ORG_ID` could not fail closed — the session callback always
// substitutes a default — which meant a session missing its orgId would have
// rotated the default workspace's token instead of erroring.
export async function getWidgetTokenAction(): Promise<WidgetTokenResult> {
  const access = await requireOrgAccess()
  if (!access.ok) return { error: access.error }
  const info = await ensureWidgetToken(access.orgId)
  const allowedOrigins = await getWidgetAllowedOrigins(access.orgId)
  const leadCaptureMode = await getWidgetLeadCaptureMode(access.orgId)
  const answerSettings = await getWidgetAnswerSettings(access.orgId)
  const slug = await getWidgetSlug(access.orgId)
  const appearance = await getWidgetAppearance(access.orgId)
  const customizationAvailable = await orgHasFeature(access.orgId, 'white_label_widget')
  const logo = customizationAvailable ? await getWidgetLogoVersion(access.orgId) : null
  return {
    token: info.token,
    appearance,
    customizationAvailable,
    logoUrl: logo ? widgetLogoPath(info.token, logo.etag) : null,
    slug,
    expiresAt: info.expiresAt,
    allowedOrigins: allowedOrigins ?? '',
    leadCaptureMode,
    answerScope: answerSettings.answerScope,
    guidance: answerSettings.guidance,
    canManage: (WIDGET_ADMIN_ROLES as readonly string[]).includes(access.role),
  }
}

export async function regenerateWidgetTokenAction(): Promise<WidgetTokenResult> {
  const access = await requireOrgAccess(WIDGET_ADMIN_ROLES)
  if (!access.ok) return { error: access.error }
  const info = await rotateWidgetToken(access.orgId)
  return { token: info.token, expiresAt: info.expiresAt }
}

interface WidgetOriginsResult {
  origins?: string[]
  error?: string
}

/**
 * Replace the org's widget origin allowlist. An empty list is meaningful, but
 * not permissive: per `isEmbedAllowed` in lib/widget/origin.ts, no configured
 * domains means the widget embeds nowhere except this instance's own host
 * (used by the Settings preview). Clearing the field locks embedding down, it
 * does not reopen it — there is no "unrestricted" state to restore.
 */
export async function saveWidgetOriginsAction(
  _prevState: unknown,
  formData: FormData
): Promise<WidgetOriginsResult> {
  const access = await requireOrgAccess(WIDGET_ADMIN_ROLES)
  if (!access.ok) return { error: access.error }

  const raw = formData.get('origins')
  if (typeof raw !== 'string') return { error: 'Invalid input' }

  // Normalise before storing so the request-time check compares bare hostnames
  // against bare hostnames, and the user sees exactly what will be matched
  // rather than whatever they pasted.
  const origins = parseAllowedOrigins(raw)
  await setWidgetAllowedOrigins(access.orgId, origins)
  return { origins }
}

interface WidgetLeadCaptureModeResult {
  mode?: WidgetLeadCaptureMode
  error?: string
}

/**
 * Changes when the widget interrupts a visitor to ask for an email — the
 * same class of "breaks the live widget's behaviour" decision as the token
 * and allowlist actions above, so it gets the same owner/admin gate.
 */
export async function saveWidgetLeadCaptureModeAction(
  _prevState: unknown,
  formData: FormData
): Promise<WidgetLeadCaptureModeResult> {
  const access = await requireOrgAccess(WIDGET_ADMIN_ROLES)
  if (!access.ok) return { error: access.error }

  const mode = formData.get('mode')
  if (!isWidgetLeadCaptureMode(mode)) return { error: 'Invalid mode' }

  await setWidgetLeadCaptureMode(access.orgId, mode)
  return { mode }
}

interface WidgetAnswerScopeResult {
  scope?: WidgetAnswerScope
  error?: string
}

/**
 * Changes what the widget may answer from. It decides what the widget tells
 * a visitor in the workspace's name, so it gets the owner/admin gate like the
 * other widget settings. Server actions can be called directly, so the role is
 * checked here and the value is validated here, not trusted from the form.
 */
export async function saveWidgetAnswerScopeAction(
  _prevState: unknown,
  formData: FormData
): Promise<WidgetAnswerScopeResult> {
  const access = await requireOrgAccess(WIDGET_ADMIN_ROLES)
  if (!access.ok) return { error: access.error }

  const scope = formData.get('scope')
  if (!isWidgetAnswerScope(scope)) return { error: 'Invalid answer scope' }

  await setWidgetAnswerScope(access.orgId, scope)
  return { scope }
}

interface WidgetGuidanceResult {
  guidance?: string | null
  error?: string
}

/**
 * Saves the note on tone and next steps that is added to the widget's
 * instructions. The same gate and the same direct-call caution as above; the
 * note is cleaned and length-limited before it is stored, and what is returned
 * is exactly what was stored, so the form shows what will be used.
 */
export async function saveWidgetGuidanceAction(
  _prevState: unknown,
  formData: FormData
): Promise<WidgetGuidanceResult> {
  const access = await requireOrgAccess(WIDGET_ADMIN_ROLES)
  if (!access.ok) return { error: access.error }

  const result = normalizeWidgetGuidance(formData.get('guidance'))
  if (!result.ok) return { error: result.error }

  await setWidgetGuidance(access.orgId, result.value)
  return { guidance: result.value }
}

interface WidgetSlugResult {
  slug?: string | null
  error?: string
}

/**
 * Sets the public slug the embed snippet carries instead of the token, or
 * clears it when the field is empty. Clearing it breaks every embed that uses
 * the slug, the same class of change as rotating the token, so it gets the same
 * owner/admin gate.
 */
export async function saveWidgetSlugAction(
  _prevState: unknown,
  formData: FormData
): Promise<WidgetSlugResult> {
  const access = await requireOrgAccess(WIDGET_ADMIN_ROLES)
  if (!access.ok) return { error: access.error }

  const raw = formData.get('slug')
  if (typeof raw !== 'string') return { error: 'Invalid input' }

  const result = await setWidgetSlug(access.orgId, raw.trim() === '' ? null : raw)
  if (!result.ok) return { error: result.error }
  return { slug: result.slug }
}

interface WidgetAppearanceResult {
  appearance?: WidgetAppearance
  /** Which field a message belongs to, so the form can show it next to the control. */
  field?: 'title' | 'welcome' | 'brandColor' | 'starterQuestions'
  error?: string
}

const CUSTOMIZATION_REQUIRES_PRO =
  'Customizing the widget is included with Pro and above. Upgrade your plan to change its title, welcome message and color.'

/**
 * Saves the chat title, welcome message and brand color. Pro and above only:
 * the plan is checked here, on the server, because the settings screen showing
 * the controls locked is a courtesy and not the rule. Same owner/admin gate as
 * the rest of the widget settings, and the workspace comes from the verified
 * membership, never from the form. What is returned is exactly what was
 * stored, so the form shows what is in use.
 */
export async function saveWidgetAppearanceAction(
  _prevState: unknown,
  formData: FormData
): Promise<WidgetAppearanceResult> {
  const access = await requireOrgAccess(WIDGET_ADMIN_ROLES)
  if (!access.ok) return { error: access.error }
  if (!(await orgHasFeature(access.orgId, 'white_label_widget'))) {
    return { error: CUSTOMIZATION_REQUIRES_PRO }
  }

  const title = normalizeWidgetTitle(formData.get('title'))
  if (!title.ok) return { field: 'title', error: title.error }
  const welcome = normalizeWidgetWelcome(formData.get('welcome'))
  if (!welcome.ok) return { field: 'welcome', error: welcome.error }
  const color = normalizeBrandColor(formData.get('brandColor'))
  if (!color.ok) return { field: 'brandColor', error: color.error }
  const starters = normalizeStarterQuestions(formData.get('starterQuestions'))
  if (!starters.ok) return { field: 'starterQuestions', error: starters.error }

  const appearance = await setWidgetAppearance(access.orgId, {
    title: title.value,
    welcome: welcome.value,
    brandColor: color.value,
    starterQuestions: starters.value,
    starterEnabled: readStarterEnabled(formData.get('starterEnabled')),
    followUpsEnabled: readFollowUpsEnabled(formData.get('followUpsEnabled')),
  })
  return { appearance }
}

/** Puts the widget back to the answerLoops title, welcome message and color. */
export async function resetWidgetAppearanceAction(): Promise<WidgetAppearanceResult> {
  const access = await requireOrgAccess(WIDGET_ADMIN_ROLES)
  if (!access.ok) return { error: access.error }
  if (!(await orgHasFeature(access.orgId, 'white_label_widget'))) {
    return { error: CUSTOMIZATION_REQUIRES_PRO }
  }
  const appearance = await setWidgetAppearance(access.orgId, { title: null, welcome: null, brandColor: null, starterQuestions: [], starterEnabled: true, followUpsEnabled: true })
  // Back to the answerLoops look includes the answerLoops mark.
  await deleteWidgetLogo(access.orgId)
  return { appearance }
}
