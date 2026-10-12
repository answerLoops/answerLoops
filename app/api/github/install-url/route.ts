import { type NextRequest, NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { createOAuthState, setOAuthNonceCookie } from '@/lib/oauth/state'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/github/install-url'

export async function GET(req: NextRequest) {
  const rawSlug = process.env.GITHUB_APP_SLUG
  if (!rawSlug) {
    return NextResponse.json({ error: 'GITHUB_APP_SLUG not configured' }, { status: 503 })
  }

  // Accept full URL or bare slug — always use the last non-empty path segment
  // e.g. "https://github.com/settings/apps/answerloops" → "answerloops"
  const slug = rawSlug.split('/').filter(Boolean).pop() ?? ''
  if (!slug || slug.startsWith('http')) {
    return NextResponse.json({ error: 'GITHUB_APP_SLUG is not a valid slug or URL' }, { status: 503 })
  }

  // The callback exchanges the install redirect's authorization code, which
  // needs the App's OAuth client credentials.
  if (!process.env.GITHUB_APP_CLIENT_ID || !process.env.GITHUB_APP_CLIENT_SECRET) {
    return NextResponse.json({ error: 'GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET must be configured' }, { status: 503 })
  }

  try {
    const access = await requireOrgAccess(['owner', 'admin'])
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.error === 'Unauthorized' ? 401 : 403 })
    }

    // Where the flow started, so the callback returns the user to the right
    // screen. Only 'onboarding' is meaningful; anything else means Integrations.
    const from = req.nextUrl.searchParams.get('from') === 'onboarding' ? 'onboarding' : 'integrations'
    const { state, nonce } = createOAuthState({ provider: 'github', orgId: access.orgId, userId: access.userId, from })

    const url = `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`
    return setOAuthNonceCookie(NextResponse.json({ url }), 'github', nonce)
  } catch (err) {
    logger.error('github install url generation failed', { module: MOD, requestId: getRequestId(req), error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
