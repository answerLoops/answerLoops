import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * A deep link's query string is usually the reason the link exists.
 *
 * The signup funnel routes every "start" button through auth and finishes on
 * /checkout, where the plan is chosen. A signed-out visitor following a link
 * to `/checkout?plan=pro` therefore hits the auth gate first, and the gate is
 * what decides where they come back to. It used to build that destination from
 * the pathname alone, so `?plan=pro` was dropped in transit and the visitor
 * landed on the default plan — a change of plan they never made, invisible
 * until it showed up as the wrong line on an invoice.
 *
 * Asserted against the source rather than by booting the middleware: the
 * callback is assembled inside NextAuth's `authorized` callback, which needs
 * the whole auth config and a real request to invoke, and the property worth
 * protecting is simply that the query survives.
 */

const authSrc = fs.readFileSync(path.join(process.cwd(), 'auth.ts'), 'utf-8')

describe('the auth gate returns a visitor to the link they actually followed', () => {
  it('carries the query string into callbackUrl, not just the path', () => {
    expect(authSrc).toContain('`${pathname}${search}`')
  })

  it('reads search off the request rather than reconstructing it', () => {
    expect(authSrc).toMatch(/const \{ pathname, search \} = request\.nextUrl/)
  })

  it('does not set callbackUrl from the bare pathname any more', () => {
    // The exact expression that dropped the plan.
    expect(authSrc).not.toContain("loginUrl.searchParams.set('callbackUrl', pathname)")
  })
})

describe('the returned destination is always a path on this site', () => {
  it('is only ever assembled from this request, never from caller input', () => {
    // pathname and search both come off request.nextUrl, so the value is
    // relative by construction. The destination must always be derived from
    // the request itself.
    const block = authSrc.slice(authSrc.indexOf('const loginUrl'), authSrc.indexOf('return NextResponse.redirect(loginUrl)'))
    expect(block).toContain('${pathname}${search}')
    expect(block).not.toMatch(/searchParams\.get\(/)
  })

  it('is re-checked for a leading single slash where it is consumed', () => {
    // The consumer validates independently of what the gate produces: /login
    // is reachable directly, so it accepts only a same-site relative path
    // regardless of how the value got there.
    const actions = fs.readFileSync(path.join(process.cwd(), 'lib/actions/auth.ts'), 'utf-8')
    expect(actions).toContain("cb.startsWith('/')")
    expect(actions).toContain("!cb.startsWith('//')")
  })
})
