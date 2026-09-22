'use server'

import { requireOrgAccess } from '@/lib/auth/org'
import {
  ensureWidgetToken,
  rotateWidgetToken,
  setWidgetAllowedOrigins,
  getWidgetAllowedOrigins,
} from '@/lib/db/queries/widgets'
import { parseAllowedOrigins } from '@/lib/widget/origin'

// Restricting where the widget may be embedded, and rotating the token that
// makes it work, are both configuration that breaks live embeds when set
// wrong. Same class of decision as minting an API key, so the same gate.
const WIDGET_ADMIN_ROLES = ['owner', 'admin'] as const

export interface WidgetTokenResult {
  token?: string
  expiresAt?: string
  /** Newline-separated allowlist as stored; empty means unrestricted. */
  allowedOrigins?: string
  /** Whether the viewer may rotate the token or change the allowlist. */
  canManage?: boolean
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
  return {
    token: info.token,
    expiresAt: info.expiresAt,
    allowedOrigins: allowedOrigins ?? '',
    canManage: (WIDGET_ADMIN_ROLES as readonly string[]).includes(access.role),
  }
}

export async function regenerateWidgetTokenAction(): Promise<WidgetTokenResult> {
  const access = await requireOrgAccess(WIDGET_ADMIN_ROLES)
  if (!access.ok) return { error: access.error }
  const info = await rotateWidgetToken(access.orgId)
  return { token: info.token, expiresAt: info.expiresAt }
}

export interface WidgetOriginsResult {
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
