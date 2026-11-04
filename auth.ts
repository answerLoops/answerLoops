import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { users, memberships, orgs } from '@/lib/db/schema'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { resolveOrgIdForSessionUpdate, resolveOrgAccess } from '@/lib/auth/membership'
import { orgHasProductAccess, isAccessExempt } from '@/lib/billing/access'
import { appOrigin } from '@/lib/site'
import { isWebsitePath } from '@/lib/marketing/website-paths'
import { isKnownRoute } from '@/lib/marketing/known-routes'
import { notFoundResponse } from '@/lib/marketing/not-found-response'
import { beginTrial } from '@/lib/auth/signup'
import { DEFAULT_WIDGET_LEAD_CAPTURE_MODE } from '@/lib/widget/lead-capture'

const PUBLIC_PATHS = ['/', '/login', '/api/auth', '/api/ingest', '/api/feedback', '/api/slack', '/api/widget', '/widget', '/widget.js', '/api/billing/webhook', '/api/newsletter', '/unsubscribe', '/api/health', '/api/github/webhook', '/api/telegram/webhook', '/api/circle/webhook', '/api/discourse/webhook', '/api/email/ingest', '/api/mcp', '/api/v1/agent', '/openapi.json', '/.well-known', '/api/google-chat', '/api/nav-state', '/api/kb/sync-jobs/run', '/api/kb/embedding-migration/run', '/api/billing/trial-reminders/run','/vs', '/alternatives', '/about', '/blog', '/changelog', '/pricing', '/agentic-support', '/docs', '/privacy', '/terms', '/robots.txt', '/sitemap.xml', '/llms.txt', '/llms-full.txt', '/architecture', '/circle-ai-answers', '/discourse-ai-answers', '/dual-agent-ai-support', '/discord-github-support', '/mcp-support-agents', '/open-source-support', '/self-hosted-ai-support', '/self-hosting-proof', '/support-example', '/support-workflow']
const ONBOARDING_PATH = '/onboarding'
const ACCOUNT_DELETED_PATH = '/account-deleted'
const START_TRIAL_PATH = '/start-trial'
const ACCEPT_TERMS_PATH = '/accept-terms'
function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

// The marketing website — informational pages with nothing behind a login.
// Everything else (sign-in, checkout, onboarding, the whole dashboard) is the
// platform, and belongs on the app's own subdomain wherever a deployment has
// configured one; see appOrigin() in lib/site.ts. Deliberately a separate list
// from PUBLIC_PATHS above: that one governs what needs a session, this one
// governs what host something lives on, and the two questions don't have the
// same answer — /login needs no session but is still part of the platform,
// while /docs, /privacy, and /terms need no session and genuinely are the
// website. The list itself lives in lib/marketing/website-paths.ts, shared
// with next.config.ts's redirects() — that's the other half of the host
// split, sending a website path hit on the app subdomain back here.

async function provisionUser(
  email: string,
  name: string | null,
  image: string | null,
  provider: string,
  providerAccountId: string | null
): Promise<{ userId: number; orgId: number }> {
  const db = getDb()
  const signedInAt = new Date()

  // Upsert user. Everyone who signs in is recorded here — this table is the
  // list of people we can later contact, subject to their marketing choice —
  // and each sign-in stamps last_login_at. The provider's account id is
  // written once; it is the stable identity the trial ledger keys on.
  //
  // Nothing about consent is written here. Signing in is one action for a new
  // and a returning person, and this is the first moment we can tell them
  // apart; a new person accepts the terms on the step that follows
  // (lib/actions/terms.ts), and the access gate in `authorized` below holds
  // them there until they have.
  await db
    .insert(users)
    .values({ email, name, image, provider, providerAccountId, lastLoginAt: signedInAt })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name: name ?? undefined,
        image: image ?? undefined,
        lastLoginAt: signedInAt,
        providerAccountId: sql`COALESCE(${users.providerAccountId}, ${providerAccountId})`,
      },
    })

  const [user] = await db
    .select({ id: users.id, termsAcceptedAt: users.termsAcceptedAt })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  // Returning user: find existing membership
  const [existing] = await db
    .select({ orgId: memberships.orgId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .limit(1)

  if (existing) {
    // An account that predates the card-free trial and never subscribed has
    // never had a trial. Offer it once; startTrial leaves an org that already
    // has a subscription row alone and refuses anyone the ledger has seen, so
    // this cannot reset a customer or hand out a second trial. Only once the
    // terms are accepted: someone still on that step gets theirs from it.
    if (existing.role === 'owner' && user.termsAcceptedAt) {
      await beginTrial({ userId: user.id, orgId: existing.orgId, email, name, providerAccountId })
    }
    return { userId: user.id, orgId: existing.orgId }
  }

  // New user: create a fresh org workspace. The trial starts when they accept
  // the terms, not here.
  //
  // widgetLeadCaptureMode is set explicitly rather than left to the column's
  // own default: that default is 'up-front' so existing workspaces aren't
  // silently switched when the column was added, but a brand-new workspace
  // should start on the product's actual recommended behavior. See
  // lib/widget/lead-capture.ts and lib/db/schema.ts's doc comment on the column.
  const [newOrg] = await db
    .insert(orgs)
    .values({
      name: 'My Workspace',
      slug: `org-${user.id}-${Date.now()}`,
      widgetLeadCaptureMode: DEFAULT_WIDGET_LEAD_CAPTURE_MODE,
    })
    .returning({ id: orgs.id })

  await db
    .insert(memberships)
    .values({ userId: user.id, orgId: newOrg.id, role: 'owner' })
    .onConflictDoNothing()

  return { userId: user.id, orgId: newOrg.id }
}

// Cloud runs the dashboard at app.answerloops.com alongside the marketing
// site's root domain (a Railway custom-domain plan cap means they share one
// service rather than each getting its own — see next.config.ts). A session
// cookie is host-only by default, so a user signed in on the root domain
// would appear logged out the moment a link sent them to the app subdomain.
// AUTH_COOKIE_DOMAIN shares the cookie across every subdomain of the apex;
// self-hosted deployments never set it, so their cookie stays host-only.
const cookieDomain = process.env.AUTH_COOKIE_DOMAIN
const useSecureCookies = process.env.NODE_ENV === 'production'

export const { handlers, signIn, signOut, auth, unstable_update } = NextAuth({
  providers: [
    Google,
  ],

  pages: {
    signIn: '/login',
    error: '/login',
  },

  // Without this, Auth.js always completes the OAuth flow on the fixed
  // AUTH_URL host, so a login started from app.answerloops.com would still
  // land back on the root marketing domain after Google's redirect — no
  // per-route link fix can work around that, since it happens at the auth
  // layer before routing is even involved. Scoped to the same cookieDomain
  // signal as above: only cloud's multi-subdomain setup needs Auth.js to
  // trust the request's Host header: instead of a single fixed origin;
  // self-hosted single-domain deployments keep trusting only their explicit
  // AUTH_URL, unchanged. Safe here because both domains sit behind
  // Cloudflare/Railway, which set the forwarded-host header from the actual
  // edge request rather than passing through anything client-supplied.
  ...(cookieDomain && { trustHost: true }),

  // Deliberately not Auth.js's default cookie name — this cookie's Domain
  // is broader than what browsers already held under that default name, so
  // reusing it risked ambiguous session resolution. See the internal
  // security page for details. Renaming forces every browser to establish a
  // fresh session under this cookie once, which is expected and safe.
  // Only sessionToken got this treatment when the multi-subdomain setup was
  // built, because it's the cookie that matters once someone is signed in.
  // The OAuth handshake itself sets three more, all short-lived and all
  // host-only by Auth.js's own default: pkceCodeVerifier, state, and nonce.
  // They didn't matter on a single-domain deployment, where every step of one
  // sign-in attempt necessarily happens on the same host anyway.
  //
  // They matter now. Signing in starts on app.answerloops.com (the platform
  // host-forcing redirect above ensures that), and Auth.js's own redirect_uri
  // construction for the Google authorize request is where the flow can
  // still end up crossing back toward AUTH_URL's host depending on exactly
  // which code path built it — confirmed in production logs, not assumed:
  // InvalidCheck: pkceCodeVerifier value could not be parsed, immediately
  // after the multi-subdomain redirect started forcing every sign-in through
  // app.answerloops.com. The verifier cookie was set on one host and read
  // back on the other, so Auth.js could not find it and failed the exchange
  // for every account, new and returning alike — cookie-level, not
  // account-level, which is why it wasn't selective.
  //
  // __Secure- rather than Auth.js's default __Host- prefix for the same
  // reason as sessionToken: __Host- forbids a Domain attribute outright, and
  // sharing across the apex is the entire point here.
  ...(cookieDomain && {
    cookies: {
      sessionToken: {
        name: useSecureCookies ? '__Secure-authjs.apex-session-token' : 'authjs.apex-session-token',
        options: {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: useSecureCookies,
          domain: cookieDomain,
        },
      },
      pkceCodeVerifier: {
        name: useSecureCookies ? '__Secure-authjs.apex-pkce.code-verifier' : 'authjs.apex-pkce.code-verifier',
        options: {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: useSecureCookies,
          domain: cookieDomain,
          maxAge: 60 * 15, // matches Auth.js's own default for this cookie
        },
      },
      state: {
        name: useSecureCookies ? '__Secure-authjs.apex-state' : 'authjs.apex-state',
        options: {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: useSecureCookies,
          domain: cookieDomain,
          maxAge: 60 * 15,
        },
      },
      nonce: {
        name: useSecureCookies ? '__Secure-authjs.apex-nonce' : 'authjs.apex-nonce',
        options: {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: useSecureCookies,
          domain: cookieDomain,
        },
      },
      // Missed by the fix above, and the same failure mode: Auth.js's
      // createActionURL always builds the Google callback against AUTH_URL
      // when it's set (trustHost only kicks in as a fallback when AUTH_URL is
      // unset), so the callback lands on the root domain regardless of which
      // host started sign-in. Host-only by Auth.js's default, this cookie was
      // set on app.answerloops.com at sign-in and never reached that
      // root-domain callback request. With neither a query param nor a
      // readable cookie, @auth/core's createCallbackUrl falls back to
      // `url.origin` — the bare root domain — which is why every sign-in
      // landed on the marketing homepage instead of the intended destination.
      callbackUrl: {
        name: useSecureCookies ? '__Secure-authjs.apex-callback-url' : 'authjs.apex-callback-url',
        options: {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: useSecureCookies,
          domain: cookieDomain,
        },
      },
      // Same root cause a third time, this one reproduced live: the sign-out
      // confirmation page is rendered on app.answerloops.com, but its <form>
      // action posts to the fixed AUTH_URL host (the root domain) — same
      // createActionURL behavior as the callback and Google-authorize URLs
      // above. Auth.js's default csrf-token cookie uses the __Host- prefix,
      // which forbids a Domain attribute outright, so it stayed host-only on
      // app.answerloops.com and never reached the cross-host POST — the
      // server saw a csrfToken in the form body with no matching cookie and
      // rejected the request with MissingCSRF, silently failing the sign-out
      // button. __Secure- instead of __Host- for the same reason as the other
      // apex cookies: sharing across the apex requires a Domain attribute.
      csrfToken: {
        name: useSecureCookies ? '__Secure-authjs.apex-csrf-token' : 'authjs.apex-csrf-token',
        options: {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: useSecureCookies,
          domain: cookieDomain,
        },
      },
    },
  }),

  callbacks: {
    // Runs once per OAuth sign-in, before a session exists. An address the
    // provider has not verified is refused here: the trial is limited to one per
    // person by email identity, so an unverified address would let someone claim
    // a mailbox that is not theirs, or spend a stranger's trial on it.
    async signIn({ user, account, profile }) {
      if (!user.email || !account) return false
      if (account.provider === 'google' && (profile as { email_verified?: boolean } | undefined)?.email_verified !== true) {
        return '/login?error=EmailNotVerified'
      }
      return true
    },

    async authorized({ request, auth: session }) {
      const { pathname, search } = request.nextUrl

      // request.nextUrl.origin cannot be trusted anywhere in this callback.
      // Measured directly against this exact proxy.ts wiring rather than
      // assumed: NextAuth's auth() function, used as the edge proxy,
      // normalizes request.nextUrl to AUTH_URL's origin regardless of what
      // host the request actually arrived on — confirmed by logging both side
      // by side with a mismatched AUTH_URL and watching request.nextUrl.origin
      // echo AUTH_URL every time, on every request, not only the ones this
      // file redirects. The real host has to come from the headers instead,
      // the same trust this deployment already extends to Cloudflare/Railway
      // elsewhere in this file (see the trustHost comment above) —
      // forwarded-host first, since that's what a proxied request carries,
      // host and the request's own protocol as the fallback for anything
      // reaching this directly. Every redirect below that needs to stay on
      // the current host is built from this, never from request.nextUrl.
      const incomingHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
      const incomingProto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '')
      const incomingOrigin = incomingHost ? `${incomingProto}://${incomingHost}` : request.nextUrl.origin

      // A URL no route answers to gets a real 404, before any host or sign-in
      // logic can turn it into a redirect. Without this an anonymous request
      // for a retired or mistyped URL was sent to the app's /login, and
      // search engines treat a login page standing in for a missing page as a
      // soft 404. Answered here rather than by rewriting to Next's not-found
      // page, which breaks on a host that differs from AUTH_URL's.
      if (!isKnownRoute(pathname, PUBLIC_PATHS)) return notFoundResponse()

      // Checked before anything else, including the public-path exemption
      // below: an anonymous request for a platform page on the wrong host
      // should land on /login on the RIGHT host, not bounce through /login on
      // the wrong one first and only get moved on the next hop. /api/ routes
      // are excluded — they're called by webhooks and fetches, not navigated
      // to, and a 307 would either break the caller or simply be ignored —
      // and so is /widget, which is embedded on customers' own pages and must
      // stay wherever it was embedded, not follow the platform to a
      // subdomain that page never asked to load content from.
      const appHostOrigin = appOrigin()
      const appHost = appHostOrigin ? new URL(appHostOrigin).host : null
      if (
        appHost &&
        incomingHost &&
        incomingHost !== appHost &&
        !isWebsitePath(pathname) &&
        !pathname.startsWith('/api/') &&
        !pathname.startsWith('/widget')
      ) {
        return NextResponse.redirect(new URL(`${pathname}${search}`, appHostOrigin!))
      }

      if (isPublic(pathname)) return true

      if (!session?.user) {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const loginUrl = new URL('/login', incomingOrigin)
        // Path *and* query. The query is often the whole point of the link:
        // `/checkout?plan=pro` returning as a bare `/checkout` silently drops
        // the plan and lands the visitor on the default one instead — a
        // downgrade they never chose and would only notice on the invoice.
        // Same for any other deep link whose parameters carry the intent.
        //
        // Relative by construction: both halves are read off this request's
        // own URL, never from anything a caller supplies, and the consumer in
        // lib/actions/auth.ts accepts only a value beginning with a single
        // slash. searchParams.set handles the encoding.
        loginUrl.searchParams.set('callbackUrl', `${pathname}${search}`)
        return NextResponse.redirect(loginUrl)
      }

      // Org state and membership are both resolved live here rather than read
      // from the token. `onboarded` only ever flips false→true and is safe to
      // cache in the session, but the two things that *revoke* access — the org
      // being soft-deleted, and the user's membership being removed — cannot
      // reach a JWT that was already issued, so a cached answer would keep
      // granting access after the fact. The account-deleted page itself is
      // exempt so a deleted org's owner can still reach the restore action.
      // See lib/auth/membership.ts for the check itself.
      if (pathname !== ACCOUNT_DELETED_PATH) {
        const sessionOrgId = (session as { orgId?: number }).orgId
        const access = await resolveOrgAccess(session.user?.id, sessionOrgId)

        // A session that can't be scoped to an org the user still belongs to is
        // ended rather than downgraded. Signing out is the same response this
        // already gave a session naming an org that no longer exists, and it
        // avoids leaving someone in a half-working state where the UI loads but
        // every query is empty.
        if (
          access.status === 'invalid-session' ||
          access.status === 'org-missing' ||
          access.status === 'not-member'
        ) {
          return NextResponse.redirect(new URL('/api/auth/signout?callbackUrl=/login', incomingOrigin))
        }

        if (access.status === 'org-deleted') {
          if (pathname.startsWith('/api/')) {
            return NextResponse.json({ error: 'This account has been deleted' }, { status: 403 })
          }
          return NextResponse.redirect(new URL(ACCOUNT_DELETED_PATH, incomingOrigin))
        }

        // Terms come first, before billing and onboarding. A new account has
        // signed in but not yet agreed to the terms, and the free trial starts
        // only when it does, so there is nothing to bill or onboard until then.
        // Read in the same query as the membership check above. The step itself
        // (/accept-terms) is exempt, and so is signing out.
        if (!access.termsAcceptedAt && pathname !== ACCEPT_TERMS_PATH) {
          if (pathname.startsWith('/api/')) {
            return NextResponse.json({ error: 'Terms not accepted' }, { status: 403 })
          }
          const termsUrl = new URL(ACCEPT_TERMS_PATH, incomingOrigin)
          // Where they were headed rides along, so an invite link or a deep link
          // is not lost on the way through. Path and query of this request only.
          if (pathname !== '/dashboard') termsUrl.searchParams.set('callbackUrl', `${pathname}${search}`)
          return NextResponse.redirect(termsUrl)
        }

        // Checked before onboarding on purpose. A new account is given a
        // card-free trial when it is created, so having access is normally
        // automatic — but an account whose trial has ended, or that was
        // refused one because the person already had theirs, has none and must
        // not reach the product. Onboarding counts as the product: it connects
        // real channels and seeds a real knowledge base.
        //
        // Anyone without access is sent to /start-trial, which forwards to
        // /checkout, where subscribing to a plan takes a card. See
        // lib/billing/access.ts for why each exempt path is exempt.
        if (!isAccessExempt(pathname)) {
          const hasAccess = await orgHasProductAccess(sessionOrgId as number)
          if (!hasAccess) {
            if (pathname.startsWith('/api/')) {
              return NextResponse.json({ error: 'No active subscription' }, { status: 402 })
            }
            return NextResponse.redirect(new URL(START_TRIAL_PATH, incomingOrigin))
          }
        }

        // Every access-exempt path must also be onboarding-exempt, or the two
        // checks fight each other. /start-trial is access-exempt (the whole point of
        // the gate is to send an unsubscribed user there) but was not
        // onboarding-exempt, so a brand-new account — unsubscribed and
        // unonboarded, which is every brand-new account — got redirected
        // /start-trial → /onboarding (not onboarded) → /start-trial (still no
        // subscription) forever. Onboarding requires access the same as
        // everything else in the product; a path that is exempt from needing
        // access cannot also demand onboarding, which itself requires access.
        if (
          pathname !== ONBOARDING_PATH &&
          !isAccessExempt(pathname) &&
          !pathname.startsWith('/api/') &&
          !(session as { onboarded?: boolean }).onboarded &&
          !access.onboardedAt
        ) {
          return NextResponse.redirect(new URL(ONBOARDING_PATH, incomingOrigin))
        }
      }

      return true
    },

    async jwt({ token, user, account, trigger, session: updateData }) {
      if (trigger === 'update' && updateData) {
        const data = updateData as { orgId?: number; onboarded?: boolean }
        // updateData is caller-supplied, and this claim scopes every org query
        // in the app, so a requested org is only adopted when the user has a
        // real membership row for it — the same source of truth
        // requireOrgAccess uses. A rejected switch leaves the existing claim in
        // place rather than erroring: it should be a no-op, not a way to break
        // a valid session.
        const allowedOrgId = await resolveOrgIdForSessionUpdate(token.userId, data.orgId)
        if (allowedOrgId !== null) token.orgId = allowedOrgId
        if (data.onboarded) token.onboarded = true
      }
      if (user?.email && account) {
        const { userId, orgId } = await provisionUser(
          user.email,
          user.name ?? null,
          user.image ?? null,
          account.provider,
          account.providerAccountId ?? null
        )
        token.userId = String(userId)
        token.orgId = orgId

        // Stamp onboarded into the JWT so returning users never hit /onboarding again
        const [org] = await getDb()
          .select({ onboardedAt: orgs.onboardedAt })
          .from(orgs)
          .where(eq(orgs.id, orgId))
          .limit(1)
        if (org?.onboardedAt) token.onboarded = true
      }
      return token
    },

    session({ session, token }) {
      session.orgId = (token.orgId as number | undefined) ?? DEFAULT_ORG_ID
      session.onboarded = token.onboarded === true
      if (session.user) {
        session.user.id = token.userId as string ?? token.sub ?? ''
      }
      return session
    },
  },
})
