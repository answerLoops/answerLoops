import postgres from 'postgres'
import { test, expect } from '@playwright/test'
import { TEST_ENV } from '../playwright.config'

// The dashboard's floating feedback widget. The board has no admin controls in
// the app: moderation, replies and updates are written by operator tooling
// outside it, which these tests stand in for with direct SQL. Covers the member
// experience, widget telemetry, and
// — the part unit tests can't reach — that a database write reaches an open
// dashboard live through trigger -> NOTIFY -> SSE -> refetch.

const FEEDBACK = 'Connecting Discord took one click and we saw our community in minutes.'

let sql: postgres.Sql

test.beforeAll(() => {
  sql = postgres(TEST_ENV.DATABASE_URL, { max: 1 })
})

test.afterAll(async () => {
  await sql.end()
})

test.beforeEach(async () => {
  await sql`DELETE FROM product_feedback`
  await sql`DELETE FROM product_updates`
})

const pill = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /open product feedback/i })

test('collapsed pill shows the logo and a live count; clicking opens the panel', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(pill(page)).toBeVisible()
  await expect(pill(page)).toHaveAccessibleName(/0 entries/)

  await pill(page).click()
  const dialog = page.getByRole('dialog', { name: /product feedback/i })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('tab', { name: /feedback/i })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByRole('tab', { name: /updates/i })).toBeVisible()

  await dialog.getByRole('button', { name: /collapse feedback/i }).click()
  await expect(dialog).toBeHidden()
  await expect(pill(page)).toBeVisible()
})

test('submitting feedback stays pending: visible to the author, not counted publicly', async ({ page }) => {
  await page.goto('/dashboard')
  await pill(page).click()
  const dialog = page.getByRole('dialog', { name: /product feedback/i })

  const submit = dialog.getByRole('button', { name: /^submit$/i })
  await expect(submit).toBeDisabled()
  await dialog.getByPlaceholder(/leave answerloops some feedback/i).fill(FEEDBACK)
  await expect(submit).toBeEnabled()
  await submit.click()

  await expect(dialog.getByRole('status')).toContainText(/awaiting review/i)
  await expect(dialog.getByText(FEEDBACK)).toBeVisible()
  await expect(dialog.getByText('Pending review').first()).toBeVisible()

  const [row] = await sql`SELECT status, org_id, user_id FROM product_feedback`
  expect(row).toMatchObject({ status: 'pending', org_id: 1, user_id: 1 })

  await dialog.getByRole('button', { name: /collapse feedback/i }).click()
  await expect(pill(page)).toHaveAccessibleName(/0 entries/)
})

test('links are rejected in the composer', async ({ page }) => {
  await page.goto('/dashboard')
  await pill(page).click()
  const dialog = page.getByRole('dialog', { name: /product feedback/i })
  await dialog.getByPlaceholder(/leave answerloops some feedback/i).fill(`${FEEDBACK} https://spam.example`)
  await expect(dialog.getByRole('button', { name: /^submit$/i })).toBeDisabled()
})

test('an approved entry reaches an open dashboard live, with no reload', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(pill(page)).toHaveAccessibleName(/0 entries/)

  // Give the shared SSE stream time to register LISTEN before we write.
  await page.waitForTimeout(1500)

  await sql`
    INSERT INTO product_feedback (author_label, body, status, approved_at)
    VALUES ('Sam K · DevRel', ${FEEDBACK}, 'approved', ${new Date().toISOString()})
  `
  await expect(pill(page)).toHaveAccessibleName(/1 entry/, { timeout: 10_000 })

  await pill(page).click()
  await expect(page.getByText('Sam K · DevRel')).toBeVisible()
  await expect(page.getByText(FEEDBACK)).toBeVisible()
})

test('another member’s pending feedback is never shown', async ({ page }) => {
  await sql`
    INSERT INTO product_feedback (org_id, user_id, body, status)
    VALUES (1, 1, 'Mine is pending and visible only to me, the author.', 'pending')
  `
  await sql`INSERT INTO users (id, email, name, provider) VALUES (2, 'other@example.com', 'Other', 'test')
    ON CONFLICT (id) DO NOTHING`
  await sql`
    INSERT INTO product_feedback (org_id, user_id, body, status)
    VALUES (1, 2, 'Somebody else pending entry that must stay hidden.', 'pending')
  `
  await page.goto('/dashboard')
  await pill(page).click()
  await expect(page.getByText(/visible only to me/)).toBeVisible()
  await expect(page.getByText(/must stay hidden/)).toHaveCount(0)

  const res = await page.request.get('/api/product-feedback')
  const body = JSON.stringify(await res.json())
  expect(body).not.toContain('must stay hidden')
  expect(body).not.toContain('other@example.com')
})

test('updates tab shows posted updates live, and has no admin controls', async ({ page }) => {
  await page.goto('/dashboard')
  await pill(page).click()
  const dialog = page.getByRole('dialog', { name: /product feedback/i })
  await dialog.getByRole('tab', { name: /updates/i }).click()
  await expect(dialog.getByText(/no updates yet/i)).toBeVisible()
  await expect(dialog.getByText(/post an update/i)).toHaveCount(0)

  await page.waitForTimeout(1500)
  await sql`INSERT INTO product_updates (title, body) VALUES ('Faster KB sync', 'Syncs now run in the background.')`
  await expect(dialog.getByText('Faster KB sync')).toBeVisible({ timeout: 10_000 })
  await expect(dialog.getByRole('button', { name: /delete/i })).toHaveCount(0)
})

// Moderation, replies and updates are written by operator tooling outside this
// app, straight into the same tables. These tests do the same with SQL, which is
// exactly what proves the table triggers push those writes to open dashboards.
test.describe('operator-side writes reach members live', () => {
  test('a posted update appears in an open widget and lights the new-update dot, then disappears when deleted', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(pill(page)).toBeVisible()
    await page.waitForTimeout(1500)

    const [row] = await sql`INSERT INTO product_updates (title, body) VALUES ('Faster KB sync', 'Syncs now run in the background.') RETURNING id`

    await expect(pill(page)).toHaveAccessibleName(/new update/i, { timeout: 10_000 })
    await pill(page).click()
    await page.getByRole('tab', { name: /updates/i }).click()
    await expect(page.getByText('Faster KB sync')).toBeVisible()

    await sql`DELETE FROM product_updates WHERE id = ${row.id}`
    await expect(page.getByText('Faster KB sync')).toHaveCount(0, { timeout: 10_000 })
  })

  test('approving and replying shows live to the author; the public payload never carries identity', async ({ page }) => {
    await page.goto('/dashboard')
    await pill(page).click()
    const dialog = page.getByRole('dialog', { name: /product feedback/i })
    await dialog.getByPlaceholder(/leave answerloops some feedback/i).fill(FEEDBACK)
    await dialog.getByRole('button', { name: /^submit$/i }).click()
    await expect(dialog.getByText('Pending review').first()).toBeVisible()

    const [{ id }] = await sql`SELECT id FROM product_feedback WHERE status = 'pending'`
    await sql`
      UPDATE product_feedback
      SET status = 'approved', approved_at = ${new Date().toISOString()},
          reply_body = 'Thanks, glad it was quick!', reply_tag = 'great_feedback',
          replied_at = ${new Date().toISOString()}
      WHERE id = ${id}`

    await expect(dialog.getByText('Thanks, glad it was quick!')).toBeVisible({ timeout: 10_000 })
    await expect(dialog.getByText('Great feedback')).toBeVisible()
    await expect(dialog.getByText('Pending review')).toHaveCount(0)

    const publicBody = JSON.stringify(await (await page.request.get('/api/product-feedback')).json())
    expect(publicBody).not.toContain('staff@example.com')
    expect(publicBody).not.toMatch(/"user_?id"/i)

    await sql`UPDATE product_feedback SET status = 'rejected', reply_body = NULL, reply_tag = NULL, replied_at = NULL WHERE id = ${id}`
    await expect(dialog.getByText('Thanks, glad it was quick!')).toHaveCount(0, { timeout: 10_000 })
    await expect(dialog.getByText('Not approved').first()).toBeVisible()

    await sql`DELETE FROM product_feedback WHERE id = ${id}`
    await expect(dialog.getByText(FEEDBACK)).toHaveCount(0, { timeout: 10_000 })
  })

  test('there is no admin API in this app', async ({ request }) => {
    for (const route of ['metrics', 'entries', 'updates']) {
      const res = await request.get(`/api/admin/feedback/${route}`, { failOnStatusCode: false })
      expect([401, 404]).toContain(res.status())
    }
  })
})

test.describe('no usage tracking', () => {
  test('using the widget writes nothing about the visit, and there is no telemetry endpoint', async ({ page }) => {
    const requests: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/api/product-feedback')) requests.push(`${r.method()} ${new URL(r.url()).pathname}`)
    })
    await page.goto('/dashboard')
    await pill(page).click()
    await page.getByRole('tab', { name: /updates/i }).click()
    await page.getByRole('tab', { name: /feedback/i }).click()
    await page.getByRole('button', { name: /collapse feedback/i }).click()
    await page.waitForTimeout(2000)

    expect([...new Set(requests)]).toEqual(['GET /api/product-feedback'])

    const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'product_widget%'`
    expect(tables).toHaveLength(0)

    const res = await page.request.post('/api/product-feedback/telemetry', { data: { sessionId: '3b241101-e2bb-4255-8caf-4136c566a962', type: 'session_start' }, failOnStatusCode: false })
    expect(res.status()).toBe(404)
  })
})
