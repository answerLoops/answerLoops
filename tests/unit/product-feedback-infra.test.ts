import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Source-level checks for the feedback board's database + live-update plumbing,
// same style as dashboard-live-infra.test.ts: no live DB, so we pin the pieces
// whose silent breakage would stop the widget updating or leak data.

const ROOT = process.cwd()
const read = (rel: string) => {
  const abs = path.join(ROOT, rel)
  expect(fs.existsSync(abs), `File not found: ${rel}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}
const flat = (s: string) => s.replace(/\s+/g, ' ')

describe('migration 0046_product_feedback.sql', () => {
  const sql = flat(read('drizzle/0046_product_feedback.sql'))

  it('creates both tables idempotently', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS product_feedback')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS product_updates')
  })

  it('constrains status to the values the app writes and has no vote column', () => {
    expect(sql).not.toMatch(/\bvote\b/)
    expect(sql).toContain("CHECK (status IN ('pending', 'approved', 'rejected'))")
  })

  it('defaults new feedback to pending so nothing is public before moderation', () => {
    expect(sql).toMatch(/status TEXT NOT NULL DEFAULT 'pending'/)
  })

  it('notifies product_feedback_changed on every write to both tables', () => {
    expect(sql).toContain("PERFORM pg_notify('product_feedback_changed', '')")
    expect(sql).toMatch(
      /CREATE TRIGGER trg_product_feedback_changed AFTER INSERT OR UPDATE OR DELETE ON product_feedback FOR EACH ROW/,
    )
    expect(sql).toMatch(
      /CREATE TRIGGER trg_product_updates_changed AFTER INSERT OR UPDATE OR DELETE ON product_updates FOR EACH ROW/,
    )
  })

  it('does not seed rows — every deployment runs this migration, only the enabled one seeds', () => {
    expect(sql).not.toContain('INSERT INTO')
  })

  it('drops triggers before creating them so the migration can be re-run', () => {
    expect(sql).toContain('DROP TRIGGER IF EXISTS trg_product_feedback_changed ON product_feedback')
    expect(sql).toContain('DROP TRIGGER IF EXISTS trg_product_updates_changed ON product_updates')
  })
})

describe('SSE stream wiring', () => {
  const route = flat(read('app/api/events/stream/route.ts'))

  it('LISTENs on product_feedback_changed', () => {
    expect(route).toContain('LISTEN product_feedback_changed')
  })

  it('forwards it to every stream (not org-filtered) as feedback_changed', () => {
    expect(route).toMatch(/product_feedback_changed: \(\) => \{ if \(isFeedbackWidgetEnabled\(\)\) send\('feedback_changed'\)/)
  })

  it('the shared client stream dispatches feedback_changed to subscribers', () => {
    const live = flat(read('lib/live-events.ts'))
    expect(live).toMatch(/type LiveEvent = [^;]*'feedback_changed'/)
    expect(live).toMatch(/DATA_EVENTS = \[[^\]]*'feedback_changed'/)
  })
})

describe('feedback snapshot privacy', () => {
  const queries = flat(read('lib/db/queries/product-feedback.ts'))
  const route = flat(read('app/api/product-feedback/route.ts'))

  it('non-admins only see approved rows or their own', () => {
    expect(queries).toContain("eq(productFeedback.status, 'approved'), eq(productFeedback.userId, input.userId)")
  })

  it('the public snapshot never selects the author email or user id into its output', () => {
    const snapshot = queries.slice(queries.indexOf('export async function getBoardSnapshot'), queries.indexOf('export async function createProductFeedback'))
    expect(snapshot).not.toMatch(/email/i)
    expect(snapshot).not.toContain('authorEmail')
  })

  it('the API route 404s when the widget is disabled, before any session or database work', () => {
    expect(route).toContain("if (!isFeedbackWidgetEnabled()) return new NextResponse('Not found', { status: 404 })")
    expect(route.indexOf('isFeedbackWidgetEnabled()')).toBeLessThan(route.indexOf('await auth()'))
  })

  it('the layout only renders the widget when enabled, and boot seeds only when enabled', () => {
    expect(flat(read('app/(dashboard)/layout.tsx'))).toContain('{isFeedbackWidgetEnabled() && <FeedbackWidget />}')
    const inst = flat(read('instrumentation.ts'))
    expect(inst).toMatch(/if \(isFeedbackWidgetEnabled\(\)\) \{[^}]*seedProductFeedbackIfEmpty/)
  })

  it('the API route requires a session and is never cached', () => {
    expect(route).toContain('status: 401')
    expect(route).toContain("'Cache-Control': 'no-store'")
  })
})

describe('operator surface stays out of this repository', () => {
  it('has no admin API routes, token, or session-proxy exemption for them', () => {
    expect(fs.existsSync(path.join(ROOT, 'app/api/admin'))).toBe(false)
    expect(read('auth.ts')).not.toContain('/api/admin')
    expect(read('playwright.config.ts')).not.toContain('FEEDBACK_ADMIN_TOKEN')
  })

  it('the server actions file only exposes the member submit action', () => {
    expect(flat(read('lib/actions/product-feedback.ts'))).not.toMatch(/moderate|reply|publish|delete/i)
  })

  it('the query layer has no operator write helpers', () => {
    const q = read('lib/db/queries/product-feedback.ts')
    for (const name of ['setProductFeedbackStatus', 'setProductFeedbackReply', 'deleteProductFeedback', 'createProductUpdate', 'deleteProductUpdate', 'listFeedbackForAdmin']) {
      expect(q).not.toContain(name)
    }
  })
})

describe('no usage tracking exists', () => {
  it('has no telemetry route, table, migration, or client hook', () => {
    expect(fs.existsSync(path.join(ROOT, 'app/api/product-feedback/telemetry'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'components/feedback/use-widget-telemetry.ts'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'drizzle/0047_product_widget_telemetry.sql'))).toBe(false)
    expect(read('lib/db/schema.ts')).not.toMatch(/product_widget|productWidget/)
  })

  it('the widget makes no request other than reading the board', () => {
    const src = read('components/feedback/feedback-widget.tsx')
    expect(src.match(/fetch\(/g)).toHaveLength(1)
    expect(src).toContain("fetch('/api/product-feedback'")
    expect(src).not.toMatch(/sendBeacon|setInterval|visibilitychange|pagehide/)
  })
})
