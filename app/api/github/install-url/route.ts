import { type NextRequest, NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { signOAuthState } from '@/lib/oauth/state'

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

  const access = await requireOrgAccess()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 401 })
  }

  // Where the flow started, so the callback returns the user to the right
  // screen. Only 'onboarding' is meaningful; anything else means Integrations.
  const from = req.nextUrl.searchParams.get('from') === 'onboarding' ? 'onboarding' : 'integrations'
  const state = signOAuthState({ orgId: access.orgId, from })

  const url = `https://github.com/apps/${slug}/installations/new?state=${state}`
  return NextResponse.json({ url })
}
