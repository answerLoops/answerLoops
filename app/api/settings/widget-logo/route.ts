import { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { ensureWidgetToken } from '@/lib/db/queries/widgets'
import { deleteWidgetLogo, setWidgetLogo } from '@/lib/db/queries/widget-logos'
import { LOGO_ERROR_MESSAGES, LOGO_MAX_BYTES, processLogoImage } from '@/lib/images/logo-pipeline'
import { widgetLogoPath } from '@/lib/widget/logo'
import { rateLimitShared } from '@/lib/ratelimit'
import { readBodyBytesCapped } from '@/lib/http/read-body-capped'
import { logger } from '@/lib/logger'

const MOD = 'api/settings/widget-logo'

// Multipart framing (boundaries, field headers) on top of the file itself.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024
const MAX_REQUEST_BYTES = LOGO_MAX_BYTES + MULTIPART_OVERHEAD_BYTES

const CUSTOMIZATION_REQUIRES_PRO =
  'Customizing the widget is included with Pro and above. Upgrade to change your logo.'

function accessStatus(error: string): number {
  return error === 'Unauthorized' ? 401 : 403
}

/**
 * Upload or replace the workspace's chat logo. Owners and admins only, on a
 * plan that includes widget customization. The workspace is always the signed-in
 * member's own; nothing in the request chooses it. The file is read with a hard
 * byte cap before anything is parsed, judged by its content (not its name or
 * declared type), and only the small re-encoded result is stored.
 */
export async function POST(req: NextRequest) {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return Response.json({ error: access.error }, { status: accessStatus(access.error) })
  const orgId = access.orgId

  if (!(await orgHasFeature(orgId, 'white_label_widget'))) {
    return Response.json({ error: CUSTOMIZATION_REQUIRES_PRO }, { status: 403 })
  }

  const limit = await rateLimitShared(`widget-logo-upload:${orgId}`, 20, 10 * 60_000)
  if (!limit.ok) {
    const mins = Math.ceil(limit.retryAfterMs / 60_000)
    return Response.json({ error: `Too many uploads. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` }, { status: 429 })
  }

  // Refuse on the declared length first, then count the bytes that actually
  // arrive, so an oversized upload is never buffered whole.
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return Response.json({ error: LOGO_ERROR_MESSAGES['too-large'], code: 'too-large' }, { status: 413 })
  }
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return Response.json({ error: 'Choose an image to upload.' }, { status: 400 })
  }
  const raw = await readBodyBytesCapped(req, MAX_REQUEST_BYTES)
  if (raw === null) return Response.json({ error: LOGO_ERROR_MESSAGES['too-large'], code: 'too-large' }, { status: 413 })

  let file: FormDataEntryValue | null
  try {
    const formData = await new Response(new Uint8Array(raw), { headers: { 'content-type': contentType } }).formData()
    file = formData.get('file')
  } catch {
    return Response.json({ error: 'Choose an image to upload.' }, { status: 400 })
  }
  if (!(file instanceof File)) return Response.json({ error: 'Choose an image to upload.' }, { status: 400 })
  if (file.size > LOGO_MAX_BYTES) {
    return Response.json({ error: LOGO_ERROR_MESSAGES['too-large'], code: 'too-large' }, { status: 413 })
  }

  const result = await processLogoImage(new Uint8Array(await file.arrayBuffer()))
  if (!result.ok) {
    return Response.json({ error: result.message, code: result.code }, { status: result.code === 'too-large' ? 413 : 400 })
  }

  try {
    const { etag } = await setWidgetLogo(orgId, { contentType: result.contentType, bytes: result.bytes, etag: result.etag })
    const { token } = await ensureWidgetToken(orgId)
    return Response.json({ logoUrl: widgetLogoPath(token, etag) })
  } catch (error) {
    logger.error('widget logo save failed', { module: MOD, orgId, error })
    return Response.json({ error: 'We could not save that logo. Try again.' }, { status: 500 })
  }
}

/**
 * Remove the workspace's chat logo so the chat goes back to the answerLoops
 * mark. Owners and admins only. Allowed on any plan, so a workspace can always
 * delete what it uploaded.
 */
export async function DELETE() {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return Response.json({ error: access.error }, { status: accessStatus(access.error) })
  try {
    await deleteWidgetLogo(access.orgId)
    return Response.json({ logoUrl: null })
  } catch (error) {
    logger.error('widget logo remove failed', { module: MOD, orgId: access.orgId, error })
    return Response.json({ error: 'We could not remove that logo. Try again.' }, { status: 500 })
  }
}
