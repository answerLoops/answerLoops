import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { isEmbedAllowed, parseAllowedOrigins, resolveEmbedOrigin } from '@/lib/widget/origin'

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8')

describe('lib/widget/origin: allowlist parsing', () => {
  it('accepts what people actually paste', () => {
    const parsed = parseAllowedOrigins('https://example.com/\n  Acme.COM \nfoo.dev:8443')
    expect(parsed).toEqual(['example.com', 'acme.com', 'foo.dev'])
  })

  it('splits on commas as well as newlines', () => {
    expect(parseAllowedOrigins('a.com, b.com')).toEqual(['a.com', 'b.com'])
  })

  it('drops entries that are not parseable as hosts', () => {
    expect(parseAllowedOrigins('example.com\n\n   \n')).toEqual(['example.com'])
  })

  it('treats null/empty as no allowlist', () => {
    expect(parseAllowedOrigins(null)).toEqual([])
    expect(parseAllowedOrigins('')).toEqual([])
  })
})

describe('lib/widget/origin: embed enforcement', () => {
  const allowed = ['example.com']
  const SELF = 'app.answerloops.com'

  it('denies by default when no domains are configured', () => {
    // Opt-in would protect only the orgs that already thought about it, and
    // there is no pre-existing embed to preserve — the allowlist ships with
    // the feature.
    expect(isEmbedAllowed('anyone.test', [], SELF)).toEqual({
      allowed: false,
      reason: 'not-configured',
    })
  })

  it('allows a configured host and its subdomains', () => {
    expect(isEmbedAllowed('example.com', allowed, SELF).allowed).toBe(true)
    expect(isEmbedAllowed('docs.example.com', allowed, SELF).allowed).toBe(true)
  })

  it('rejects a different host', () => {
    expect(isEmbedAllowed('attacker.test', allowed, SELF)).toEqual({
      allowed: false,
      reason: 'origin-not-allowed',
    })
  })

  it('rejects a lookalike that merely ends with the allowed string', () => {
    expect(isEmbedAllowed('notexample.com', allowed, SELF).allowed).toBe(false)
  })

  it('always allows our own host, so the Settings preview needs no configuration', () => {
    expect(isEmbedAllowed(SELF, [], SELF).allowed).toBe(true)
    expect(isEmbedAllowed(SELF, allowed, SELF).allowed).toBe(true)
  })

  it('refuses when the embedding origin cannot be determined', () => {
    expect(isEmbedAllowed(null, allowed, SELF)).toEqual({
      allowed: false,
      reason: 'origin-unknown',
    })
  })
})

describe('lib/widget/origin: resolving the embedding origin', () => {
  it('reads the Referer header', () => {
    expect(resolveEmbedOrigin('https://example.com/pricing')).toBe('example.com')
  })

  it('is null when Referer is absent or unusable', () => {
    expect(resolveEmbedOrigin(null)).toBe(null)
    expect(resolveEmbedOrigin('not a url')).toBe(null)
  })

  it('takes only one argument, so no caller-supplied value can substitute', () => {
    // Referer is the only accepted signal. Pinning the arity stops a
    // caller-authored value being reintroduced as a fallback alongside it.
    expect(resolveEmbedOrigin.length).toBe(1)
  })
})

describe('widget lead endpoint carries the standard abuse controls', () => {
  const src = () => read('app/api/widget/lead/route.ts')

  it('rate limits per token and per IP, using the shared store', () => {
    const s = src()
    expect(s).toContain('rateLimitShared(`widget-lead-token:')
    // Formatted across lines, so match the bucket key rather than the call.
    expect(s).toContain('`widget-lead-ip:${widgetToken}:${ip}`')
    expect(s).toMatch(/rateLimitShared\(\s*`widget-lead-ip:/)
  })

  it('rate limits before resolving the token, so junk floods cost no DB lookup', () => {
    const s = src()
    const limitIdx = s.indexOf('rateLimitShared(`widget-lead-token:')
    const lookupIdx = s.indexOf('getOrgByWidgetToken(')
    expect(limitIdx).toBeGreaterThan(-1)
    expect(limitIdx).toBeLessThan(lookupIdx)
  })

  it('caps the request body instead of parsing whatever arrives', () => {
    const s = src()
    expect(s).toContain('readBodyCapped(request, MAX_BODY_BYTES)')
    expect(s).not.toContain('await request.json()')
  })

  it('bounds the email length and shape rather than checking for an @', () => {
    const s = src()
    expect(s).toContain('MAX_EMAIL_CHARS')
    expect(s).toContain('EMAIL_PATTERN.test(normalized)')
    // The original check stored any string containing an @, at any length.
    expect(s).not.toContain("email.includes('@')")
  })

  it('does not pretend to enforce the allowlist, which is not observable here', () => {
    const s = src()
    // This request is same-origin to us, so its Origin header is our own
    // hostname. A check here would be inert at best and would break the
    // legitimate widget once an org configured domains.
    expect(s).not.toContain('isOriginAllowed')
    expect(s).toContain('allowlist is enforced at the iframe navigation')
  })
})

describe('widget chat endpoint hardening', () => {
  const src = () => read('app/api/widget/chat/route.ts')

  it('uses the shared rate-limit store so the ceiling is not per-instance', () => {
    const s = src()
    expect(s).toContain('await rateLimitShared(`widget-token:')
    expect(s).toContain('await rateLimitShared(`widget-ip:')
    expect(s).not.toContain("import { rateLimit }")
  })

  it('caps the request body', () => {
    const s = src()
    expect(s).toContain('readBodyCapped(request, MAX_BODY_BYTES)')
    expect(s).not.toContain('await request.json()')
  })

  it('does not pretend to enforce the allowlist, which is not observable here', () => {
    const s = src()
    expect(s).not.toContain('isOriginAllowed')
    expect(s).toContain('allowlist is enforced at the iframe navigation')
  })

  it('resolves the client IP through the trusted-proxy chain', () => {
    expect(src()).toContain('clientIp(request)')
  })
})

describe('widget token actions cannot act on a defaulted org', () => {
  const src = () => read('lib/actions/widget.ts')

  it('resolves the org from a verified membership', () => {
    const s = src()
    expect(s).toContain('requireOrgAccess()')
  })

  it('never falls back to a default org id', () => {
    // Rotation is destructive: it invalidates the live token and breaks every
    // page the widget is embedded on. Doing that to the wrong org is the worst
    // possible outcome of a silent default. Checked as real usage rather than
    // any mention, since the comment above the actions explains the removal.
    const s = src()
    expect(s).not.toMatch(/\?\?\s*DEFAULT_ORG_ID/)
    expect(s).not.toMatch(/^import .*DEFAULT_ORG_ID/m)
  })

  it('gates destructive and configuration actions to owner/admin', () => {
    const s = src()
    expect(s).toContain("const WIDGET_ADMIN_ROLES = ['owner', 'admin'] as const")
    // Rotation breaks every live embed; the allowlist decides where the widget
    // works at all. Both are owner/admin. Reading the token stays open to any
    // member so they can still see the embed snippet.
    const gated = [...s.matchAll(/requireOrgAccess\(WIDGET_ADMIN_ROLES\)/g)]
    expect(gated.length).toBe(2)
    const ungated = [...s.matchAll(/requireOrgAccess\(\)/g)]
    expect(ungated.length).toBe(1)
  })

  it('reports canManage so the UI does not render controls a member cannot use', () => {
    const s = src()
    expect(s).toContain('canManage:')
    expect(s).toContain('allowedOrigins:')
  })
})

describe('schema + migration for the origin allowlist', () => {
  it('adds a nullable column so existing embeds stay unrestricted', () => {
    const migration = read('drizzle/0020_widget_allowed_origins.sql')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS widget_allowed_origins text')
    expect(migration).not.toContain('NOT NULL')
  })

  it('declares the column on the orgs table', () => {
    expect(read('lib/db/schema.ts')).toContain("widgetAllowedOrigins: text('widget_allowed_origins')")
  })

  it('exposes the allowlist through the token lookup the endpoints use', () => {
    expect(read('lib/db/queries/widgets.ts')).toContain('widget_allowed_origins: orgs.widgetAllowedOrigins')
  })
})

describe('Settings → Widget exposes the allowlist', () => {
  const src = () => read('app/(dashboard)/settings/page.tsx')

  it('renders a domains field wired to the save action', () => {
    const s = src()
    expect(s).toContain('saveWidgetOriginsAction')
    expect(s).toMatch(/Allowed domains/)
  })

  it('hides the editor and the rotate control from members', () => {
    const s = src()
    // Both are behind canManage; a member sees the current state read-only.
    expect(s).toContain('{canManage ? (')
    expect(s).toContain('{!canManage ? null : confirmRotate ? (')
  })

  it('explains why the allowlist matters rather than just labelling the field', () => {
    const s = src()
    expect(s).toMatch(/visible in your page source/i)
  })

  it('keeps the destructive-rotation confirmation', () => {
    expect(src()).toContain('Old token breaks immediately.')
  })
})

describe('the allowlist is enforced where the parent origin is visible', () => {
  const page = () => read('app/widget/[widgetToken]/page.tsx')

  it('checks the embed origin on the iframe navigation', () => {
    const s = page()
    expect(s).toContain('resolveEmbedOrigin(headerList.get(\'referer\')')
    expect(s).toContain('isEmbedAllowed(')
  })

  it('treats our own host as always allowed', () => {
    expect(page()).toContain("normalizeHost(headerList.get('host'))")
  })

  it('renders an explanation rather than failing blank', () => {
    const s = page()
    expect(s).toContain('EmbedRefused')
    expect(s).not.toMatch(/if \(!decision\.allowed\) notFound\(\)/)
  })

  it('the refusal screen does not leak whether the token is valid', () => {
    // Strip comments first: the file explains this property in prose, and
    // matching the whole source would flag its own rationale.
    const s = read('app/widget/[widgetToken]/embed-refused.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(s).not.toMatch(/orgName|knowledge base|invalid token/i)
  })

  it('widget.js sends no caller-supplied origin', () => {
    // Comments stripped: the file explains why the parameter is absent, and
    // matching raw source would flag its own rationale.
    const s = read('public/widget.js').replace(/\/\/.*$/gm, '')
    expect(s).toContain("iframe.src = baseUrl + '/widget/' + widgetId;")
    expect(s).not.toContain('?parent=')
    expect(s).not.toContain('parentOrigin')
    // window.location.origin still appears legitimately, as the fallback for
    // deriving baseUrl when script.src is unavailable — that is unrelated.
  })

  it('the page reads the embed origin from headers only', () => {
    const s = read('app/widget/[widgetToken]/page.tsx')
    expect(s).toContain("resolveEmbedOrigin(headerList.get('referer'))")
    expect(s).not.toContain('searchParams')
  })
})
