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
  await sql`DELETE FROM product_feedback_votes`
  // Submissions and votes are rate-limited per person per hour and the
  // counters live in the database, so repeated local runs would otherwise
  // trip a cap (5 submissions, 60 votes) for reasons unrelated to the test.
  await sql`DELETE FROM rate_limit_buckets WHERE key LIKE 'product-feedback%'`
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

// ---------------------------------------------------------------------------
// Up-votes. Unit tests mock the database, so the rules — one vote per person,
// no self-vote, approved entries only, anonymous, gone with the workspace — are
// proven here against real Postgres, with the trigger -> SSE -> refetch path in
// between. Where the UI offers no control (own entry, pending entry) the call
// is forged straight at the server action, the way a hostile client would.
// ---------------------------------------------------------------------------
test.describe('up-votes', () => {
  const SESSION_COOKIE = 'authjs.session-token'
  type Dialog = ReturnType<import('@playwright/test').Page['getByRole']>

  async function sessionCookieFor(userId: number, orgId: number) {
    const { encode } = await import('next-auth/jwt')
    const now = Math.floor(Date.now() / 1000)
    const exp = now + 3600
    const value = await encode({
      token: {
        sub: String(userId),
        name: `User ${userId}`,
        email: `user${userId}@example.com`,
        userId: String(userId),
        orgId,
        iat: now,
        exp,
      },
      secret: TEST_ENV.AUTH_SECRET,
      salt: SESSION_COOKIE,
      maxAge: 3600,
    })
    return {
      name: SESSION_COOKIE,
      value,
      domain: 'localhost',
      path: '/',
      expires: exp,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax' as const,
    }
  }

  async function seedMember(userId: number, orgId: number) {
    if (orgId !== 1) {
      await sql`INSERT INTO orgs (id, name, slug, onboarded_at) VALUES (${orgId}, ${`Org ${orgId}`}, ${`org-${orgId}`}, NOW())
        ON CONFLICT (id) DO NOTHING`
    }
    // An earlier test in this file may have created this user without terms
    // acceptance; without it the account is held on /accept-terms and never
    // reaches the dashboard, so the acceptance is upserted the way global-setup does.
    await sql`INSERT INTO users (id, email, name, provider, terms_accepted_at, terms_version)
      VALUES (${userId}, ${`user${userId}@example.com`}, ${`User ${userId}`}, 'test', NOW(), 'e2e')
      ON CONFLICT (id) DO UPDATE SET
        terms_accepted_at = COALESCE(users.terms_accepted_at, NOW()),
        terms_version = COALESCE(users.terms_version, 'e2e')`
    await sql`INSERT INTO memberships (user_id, org_id, role)
      SELECT ${userId}, ${orgId}, 'member'
      WHERE NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = ${userId} AND org_id = ${orgId})`
  }

  async function entry(body: string, opts: { author?: { userId: number; orgId: number }; status?: 'approved' | 'pending' | 'rejected' } = {}) {
    const status = opts.status ?? 'approved'
    const approvedAt = status === 'approved' ? new Date().toISOString() : null
    const [row] = opts.author
      ? await sql`INSERT INTO product_feedback (org_id, user_id, body, status, approved_at)
          VALUES (${opts.author.orgId}, ${opts.author.userId}, ${body}, ${status}, ${approvedAt}) RETURNING id`
      : await sql`INSERT INTO product_feedback (author_label, body, status, approved_at)
          VALUES ('Sam K · DevRel', ${body}, ${status}, ${approvedAt}) RETURNING id`
    return row.id as number
  }

  const votesFor = (id: number) => sql`SELECT user_id, org_id FROM product_feedback_votes WHERE feedback_id = ${id}`

  async function openBoard(page: import('@playwright/test').Page) {
    await page.goto('/dashboard')
    await pill(page).click()
    const dialog = page.getByRole('dialog', { name: /product feedback/i })
    await expect(dialog).toBeVisible()
    return dialog
  }
  const card = (dialog: Dialog, body: string) => dialog.getByRole('listitem').filter({ hasText: body })
  const upvote = (scope: Dialog) => scope.getByRole('button', { name: /upvote/i })

  // A server action is a POST to the page with a `next-action` header. The id
  // lives in the client bundle, so it is captured from one real click and then
  // replayed with payloads the UI would never send.
  async function captureAction(page: import('@playwright/test').Page, click: () => Promise<void>) {
    const seen = page.waitForRequest((r) => r.method() === 'POST' && Boolean(r.headers()['next-action']))
    await click()
    const req = await seen
    return {
      url: req.url(),
      headers: {
        'next-action': req.headers()['next-action'],
        'content-type': req.headers()['content-type'] ?? 'text/plain;charset=UTF-8',
        accept: 'text/x-component',
      },
    }
  }
  type Action = Awaited<ReturnType<typeof captureAction>>
  const forged = (page: import('@playwright/test').Page, action: Action, payload: unknown) =>
    page.request.post(action.url, { headers: action.headers, data: JSON.stringify([payload]), failOnStatusCode: false })

  test('adds a vote and takes it back; the count follows at once and the row follows in the database', async ({ page }) => {
    const id = await entry(FEEDBACK)
    const dialog = await openBoard(page)
    const button = upvote(card(dialog, FEEDBACK))
    await expect(button).toHaveAttribute('aria-pressed', 'false')
    await expect(button).toHaveText('0')

    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await expect(button).toHaveText('1')
    await expect.poll(async () => (await votesFor(id)).length).toBe(1)
    expect((await votesFor(id))[0]).toMatchObject({ user_id: 1, org_id: 1 })

    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'false')
    await expect(button).toHaveText('0')
    await expect.poll(async () => (await votesFor(id)).length).toBe(0)
  })

  test('two people: the count shows both live, each sees only their own vote, and the payload names nobody', async ({ page, browser }) => {
    await seedMember(2, 1)
    const id = await entry(FEEDBACK)

    const dialogA = await openBoard(page)
    const buttonA = upvote(card(dialogA, FEEDBACK))
    await expect(buttonA).toHaveText('0')
    // Give the shared SSE stream time to register LISTEN before the other person writes.
    await page.waitForTimeout(1500)

    const other = await browser.newContext({ baseURL: TEST_ENV.AUTH_URL })
    await other.addCookies([await sessionCookieFor(2, 1)])
    const pageB = await other.newPage()
    const dialogB = await openBoard(pageB)
    const buttonB = upvote(card(dialogB, FEEDBACK))
    await buttonB.click()
    await expect(buttonB).toHaveAttribute('aria-pressed', 'true')
    await expect(buttonB).toHaveText('1')

    // A sees the other vote arrive without a reload, and it is not A's own.
    await expect(buttonA).toHaveText('1', { timeout: 10_000 })
    await expect(buttonA).toHaveAttribute('aria-pressed', 'false')

    await buttonA.click()
    await expect(buttonA).toHaveText('2')
    await expect(buttonA).toHaveAttribute('aria-pressed', 'true')
    await expect(buttonB).toHaveText('2', { timeout: 10_000 })
    await expect(buttonB).toHaveAttribute('aria-pressed', 'true')
    expect(await votesFor(id)).toHaveLength(2)

    const body = JSON.stringify(await (await page.request.get('/api/product-feedback')).json())
    expect(body).toContain('"voteCount":2')
    expect(body).toContain('"viewerVoted":true')
    expect(body).not.toMatch(/"user_?id"/i)
    expect(body).not.toContain('user2@example.com')
    await other.close()
  })

  test('no control on your own or a pending entry, and forging the call writes nothing', async ({ page }) => {
    await seedMember(2, 1)
    const own = await entry('My own approved entry, which I must not be able to vote on.', { author: { userId: 1, orgId: 1 } })
    const pending = await entry('My pending entry, not votable by anyone yet.', { author: { userId: 1, orgId: 1 }, status: 'pending' })
    // Someone else's unapproved entries: the only thing refusing a vote on
    // these is the status rule itself, so the self-vote rule cannot mask a
    // missing status check (the viewer never sees them, so only a forged call
    // can reach them).
    const theirsPending = await entry('Another member pending entry.', { author: { userId: 2, orgId: 1 }, status: 'pending' })
    const theirsRejected = await entry('Another member rejected entry.', { author: { userId: 2, orgId: 1 }, status: 'rejected' })
    // And someone else's approved entry — the ordinary case, with a real author.
    const theirsApproved = await entry('Another member approved entry, votable by me.', { author: { userId: 2, orgId: 1 } })
    const control = await entry('A control entry, voted through the real button.')
    const probe = await entry('A probe entry, voted through a forged call.')
    const dialog = await openBoard(page)

    // The author sees a read-only count, no button; a pending entry has neither.
    const ownCard = card(dialog, 'My own approved entry')
    await expect(ownCard).toBeVisible()
    await expect(upvote(ownCard)).toHaveCount(0)
    await expect(ownCard.getByLabel(/0 upvotes/)).toBeVisible()
    const pendingCard = card(dialog, 'My pending entry')
    await expect(pendingCard).toBeVisible()
    await expect(upvote(pendingCard)).toHaveCount(0)
    await expect(pendingCard.getByLabel(/upvote/i)).toHaveCount(0)

    // One real click, to learn the action id — and to prove the forged channel
    // below actually reaches the action (an empty table would otherwise pass).
    const action = await captureAction(page, () => upvote(card(dialog, 'A control entry')).click())
    await expect.poll(async () => (await votesFor(control)).length).toBe(1)
    await forged(page, action, { feedbackId: probe, voted: true })
    await expect.poll(async () => (await votesFor(probe)).length).toBe(1)

    // A colleague's approved entry takes a vote through the real button.
    await upvote(card(dialog, 'Another member approved entry')).click()
    await expect.poll(async () => (await votesFor(theirsApproved)).length).toBe(1)
    expect((await votesFor(theirsApproved))[0]).toMatchObject({ user_id: 1, org_id: 1 })

    // Now the hostile payloads: own entry, pending entries (mine and theirs),
    // a rejected entry, forged identity, wrong types.
    await forged(page, action, { feedbackId: own, voted: true })
    await forged(page, action, { feedbackId: pending, voted: true })
    await forged(page, action, { feedbackId: theirsPending, voted: true })
    await forged(page, action, { feedbackId: theirsRejected, voted: true })
    await forged(page, action, { feedbackId: String(control), voted: false })
    await forged(page, action, { feedbackId: control, voted: 'no' })
    await page.waitForTimeout(500)
    expect(await votesFor(own)).toHaveLength(0)
    expect(await votesFor(pending)).toHaveLength(0)
    expect(await votesFor(theirsPending)).toHaveLength(0)
    expect(await votesFor(theirsRejected)).toHaveLength(0)
    expect(await votesFor(control)).toHaveLength(1)

    // A forged voter identity is ignored: the row belongs to the session, not the payload.
    await forged(page, action, { feedbackId: probe, voted: false })
    await expect.poll(async () => (await votesFor(probe)).length).toBe(0)
    await forged(page, action, { feedbackId: probe, voted: true, userId: 2, orgId: 2 })
    await expect.poll(async () => (await votesFor(probe)).length).toBe(1)
    expect((await votesFor(probe))[0]).toMatchObject({ user_id: 1, org_id: 1 })
  })

  test('a burst of simultaneous adds from one person stores exactly one row, and a burst of removes leaves none', async ({ page }) => {
    const id = await entry(FEEDBACK)
    const dialog = await openBoard(page)
    const action = await captureAction(page, () => upvote(card(dialog, FEEDBACK)).click())
    await expect.poll(async () => (await votesFor(id)).length).toBe(1)
    await sql`DELETE FROM product_feedback_votes WHERE feedback_id = ${id}`

    // Every request names the wanted state, so the outcome is deterministic:
    // one row, and every response succeeded (the losers of the race see an
    // existing row, which is the state they asked for).
    const adds = await Promise.all(Array.from({ length: 6 }, () => forged(page, action, { feedbackId: id, voted: true })))
    for (const res of adds) expect(res.status()).toBe(200)
    expect(await votesFor(id)).toHaveLength(1)
    await expect(upvote(card(dialog, FEEDBACK))).toHaveText('1', { timeout: 10_000 })

    // The constraint itself, straight at the table: a second row for the same
    // person and entry is rejected.
    await expect(sql`INSERT INTO product_feedback_votes (feedback_id, user_id, org_id) VALUES (${id}, 1, 1)`).rejects.toMatchObject({ code: '23505' })

    const removes = await Promise.all(Array.from({ length: 6 }, () => forged(page, action, { feedbackId: id, voted: false })))
    for (const res of removes) expect(res.status()).toBe(200)
    expect(await votesFor(id)).toHaveLength(0)
    await expect(upvote(card(dialog, FEEDBACK))).toHaveText('0', { timeout: 10_000 })
  })

  test('Most voted reorders the list by count and Newest restores the server order', async ({ page }) => {
    await seedMember(2, 1)
    await seedMember(3, 1)
    const older = await entry('Older entry with two votes.')
    // created_at is text written by the column default (now()::text), so the
    // shift is done in SQL to keep the same format — an ISO string with a 'T'
    // would sort after every default-written value and invert the order.
    await sql`UPDATE product_feedback SET created_at = (now() - interval '1 minute')::text WHERE id = ${older}`
    const newer = await entry('Newer entry with no votes.')
    await sql`INSERT INTO product_feedback_votes (feedback_id, user_id, org_id) VALUES (${older}, 2, 1), (${older}, 3, 1)`
    void newer

    const dialog = await openBoard(page)
    const order = async () => (await dialog.getByRole('listitem').allTextContents()).map((t) => /Older|Newer/.exec(t)?.[0])
    await expect(dialog.getByRole('button', { name: 'Newest' })).toHaveAttribute('aria-pressed', 'true')
    expect(await order()).toEqual(['Newer', 'Older'])

    // Switching the sort asks the server for the votes order, so the list
    // changes when that response lands, not on the click itself.
    await dialog.getByRole('button', { name: 'Most voted' }).click()
    await expect.poll(order).toEqual(['Older', 'Newer'])
    await expect(upvote(card(dialog, 'Older entry'))).toHaveText('2')

    await dialog.getByRole('button', { name: 'Newest' }).click()
    await expect.poll(order).toEqual(['Newer', 'Older'])
  })

  test('votes cast by a deleted workspace disappear, and open dashboards see the count drop', async ({ page }) => {
    await seedMember(2, 2)
    const id = await entry(FEEDBACK)
    await sql`INSERT INTO product_feedback_votes (feedback_id, user_id, org_id) VALUES (${id}, 2, 2)`

    const dialog = await openBoard(page)
    const button = upvote(card(dialog, FEEDBACK))
    await expect(button).toHaveText('1')
    await page.waitForTimeout(1500)

    // The workspace goes; its vote goes with it through the cascade, and the
    // votes-table trigger wakes the dashboard.
    await sql`DELETE FROM memberships WHERE org_id = 2`
    await sql`DELETE FROM orgs WHERE id = 2`
    await expect(button).toHaveText('0', { timeout: 10_000 })
    expect(await votesFor(id)).toHaveLength(0)
  })
})
