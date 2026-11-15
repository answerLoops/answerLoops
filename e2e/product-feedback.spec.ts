import postgres from 'postgres'
import { test, expect, type Page } from '@playwright/test'
import { TEST_ENV } from '../playwright.config'
import { hardPurgeOrg } from '../lib/db/queries/orgs'
import { runMigrations } from '../lib/db/migrate'

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

const pill = (page: Page) => page.getByRole('button', { name: /open product feedback/i })

// The dashboard is listening once its own EventSource has received the
// server's `connected` event, which the server sends only after its LISTEN is
// registered. Watched through the DevTools protocol, so this is the widget's
// stream and not a second one opened by the test. Arm it before the navigation
// that mounts the widget; await it before any write the open dashboard is
// expected to notice live. A fixed sleep here would pass on a fast machine
// and prove nothing on a slow one.
async function liveConnected(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  return new Promise<void>((resolve) => {
    cdp.on('Network.eventSourceMessageReceived', (event) => {
      if (event.eventName !== 'connected') return
      void cdp.detach().catch(() => undefined)
      resolve()
    })
  })
}

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
  const connected = liveConnected(page)
  await page.goto('/dashboard')
  await expect(pill(page)).toHaveAccessibleName(/0 entries/)

  await connected

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
  const connected = liveConnected(page)
  await page.goto('/dashboard')
  await pill(page).click()
  const dialog = page.getByRole('dialog', { name: /product feedback/i })
  await dialog.getByRole('tab', { name: /updates/i }).click()
  await expect(dialog.getByText(/no updates yet/i)).toBeVisible()
  await expect(dialog.getByText(/post an update/i)).toHaveCount(0)

  await connected
  await sql`INSERT INTO product_updates (title, body) VALUES ('Faster KB sync', 'Syncs now run in the background.')`
  await expect(dialog.getByText('Faster KB sync')).toBeVisible({ timeout: 10_000 })
  await expect(dialog.getByRole('button', { name: /delete/i })).toHaveCount(0)
})

// Moderation, replies and updates are written by operator tooling outside this
// app, straight into the same tables. These tests do the same with SQL, which is
// exactly what proves the table triggers push those writes to open dashboards.
test.describe('operator-side writes reach members live', () => {
  test('a posted update appears in an open widget and lights the new-update dot, then disappears when deleted', async ({ page }) => {
    const connected = liveConnected(page)
    await page.goto('/dashboard')
    await expect(pill(page)).toBeVisible()
    await connected

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

  async function openBoard(page: Page) {
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
  async function captureAction(page: Page, click: () => Promise<void>) {
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
  const forged = (page: Page, action: Action, payload: unknown) =>
    page.request.post(action.url, { headers: action.headers, data: JSON.stringify([payload]), failOnStatusCode: false })
  // What the action answered, as the browser would read it: the result object
  // is in the response body verbatim. Every probe below reads its answer, so a
  // refusal is proven by what the server said and not only by a row count
  // taken after a guessed delay.
  async function answer(page: Page, action: Action, payload: unknown) {
    const res = await forged(page, action, payload)
    expect(res.status()).toBe(200)
    return res.text()
  }
  const ADDED = '"state":"added"'
  const REMOVED = '"state":"removed"'
  const REFUSED = 'This entry cannot be voted on.'
  const INVALID = 'Invalid input'

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

    const connected = liveConnected(page)
    const dialogA = await openBoard(page)
    const buttonA = upvote(card(dialogA, FEEDBACK))
    await expect(buttonA).toHaveText('0')
    await connected

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
    expect(await answer(page, action, { feedbackId: probe, voted: true })).toContain(ADDED)
    expect(await votesFor(probe)).toHaveLength(1)

    // A colleague's approved entry takes a vote through the real button.
    await upvote(card(dialog, 'Another member approved entry')).click()
    await expect.poll(async () => (await votesFor(theirsApproved)).length).toBe(1)
    expect((await votesFor(theirsApproved))[0]).toMatchObject({ user_id: 1, org_id: 1 })

    // Now the hostile payloads: own entry, pending entries (mine and theirs),
    // a rejected entry, wrong types. Each answer is read before the rows are
    // counted, so the count is taken after the server finished, not after a
    // delay, and the refusal itself is on record.
    expect(await answer(page, action, { feedbackId: own, voted: true })).toContain(REFUSED)
    expect(await answer(page, action, { feedbackId: pending, voted: true })).toContain(REFUSED)
    expect(await answer(page, action, { feedbackId: theirsPending, voted: true })).toContain(REFUSED)
    expect(await answer(page, action, { feedbackId: theirsRejected, voted: true })).toContain(REFUSED)
    expect(await answer(page, action, { feedbackId: String(control), voted: false })).toContain(INVALID)
    expect(await answer(page, action, { feedbackId: control, voted: 'no' })).toContain(INVALID)
    expect(await votesFor(own)).toHaveLength(0)
    expect(await votesFor(pending)).toHaveLength(0)
    expect(await votesFor(theirsPending)).toHaveLength(0)
    expect(await votesFor(theirsRejected)).toHaveLength(0)
    expect(await votesFor(control)).toHaveLength(1)

    // A forged voter identity is ignored: the row belongs to the session, not the payload.
    expect(await answer(page, action, { feedbackId: probe, voted: false })).toContain(REMOVED)
    expect(await votesFor(probe)).toHaveLength(0)
    expect(await answer(page, action, { feedbackId: probe, voted: true, userId: 2, orgId: 2 })).toContain(ADDED)
    expect(await votesFor(probe)).toHaveLength(1)
    expect((await votesFor(probe))[0]).toMatchObject({ user_id: 1, org_id: 1 })

    // An entry un-approved after the vote was cast: the next add is refused
    // rather than reported as stored, so a stale card is told no instead of
    // being shown a vote. The row from before stays; nothing new is written.
    await sql`UPDATE product_feedback SET status = 'pending' WHERE id = ${theirsApproved}`
    expect(await answer(page, action, { feedbackId: theirsApproved, voted: true })).toContain(REFUSED)
    expect(await votesFor(theirsApproved)).toHaveLength(1)
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
    const adds = await Promise.all(Array.from({ length: 6 }, () => answer(page, action, { feedbackId: id, voted: true })))
    for (const text of adds) expect(text).toContain(ADDED)
    expect(await votesFor(id)).toHaveLength(1)
    await expect(upvote(card(dialog, FEEDBACK))).toHaveText('1', { timeout: 10_000 })

    // The constraint itself, straight at the table: a second row for the same
    // person and entry is rejected.
    await expect(sql`INSERT INTO product_feedback_votes (feedback_id, user_id, org_id) VALUES (${id}, 1, 1)`).rejects.toMatchObject({ code: '23505' })

    const removes = await Promise.all(Array.from({ length: 6 }, () => answer(page, action, { feedbackId: id, voted: false })))
    for (const text of removes) expect(text).toContain(REMOVED)
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

  test('purging a workspace removes the votes its members cast on another workspace\'s entries, and open dashboards see the count drop', async ({ page }) => {
    await seedMember(2, 2)
    await seedMember(3, 1)
    // The entry belongs to workspace 1 (written by a third member, so the
    // viewer still gets a button); the vote comes from a member of workspace 2.
    const id = await entry(FEEDBACK, { author: { userId: 3, orgId: 1 } })
    await sql`INSERT INTO product_feedback_votes (feedback_id, user_id, org_id) VALUES (${id}, 2, 2)`

    const connected = liveConnected(page)
    const dialog = await openBoard(page)
    const button = upvote(card(dialog, FEEDBACK))
    await expect(button).toHaveText('1')
    await connected

    // The same purge the workspace-deletion flow runs, against this database:
    // the vote goes with the voter's workspace, the entry stays with its own,
    // and the votes-table trigger wakes the dashboard.
    await hardPurgeOrg(2)
    expect(await votesFor(id)).toHaveLength(0)
    expect(await sql`SELECT id FROM product_feedback WHERE id = ${id}`).toHaveLength(1)
    await expect(button).toHaveText('0', { timeout: 10_000 })
  })

  test('Most voted is ordered in the database before the row cap, and equal counts tie-break newest first', async ({ page }) => {
    await seedMember(2, 1)
    await seedMember(3, 1)
    // Three old entries carrying every vote, then 201 newer ones with none:
    // a newest-first cap of 200 drops all three, so if the votes order were
    // applied after the cap the popular entry could not appear at all.
    const popular = await entry('The popular old entry.')
    const olderTied = await entry('The older of two tied entries.')
    const newerTied = await entry('The newer of two tied entries.')
    await sql`UPDATE product_feedback SET created_at = (now() - interval '3 minutes')::text WHERE id = ${popular}`
    await sql`UPDATE product_feedback SET created_at = (now() - interval '2 minutes')::text WHERE id = ${olderTied}`
    await sql`UPDATE product_feedback SET created_at = (now() - interval '1 minute')::text WHERE id = ${newerTied}`
    await sql`INSERT INTO product_feedback_votes (feedback_id, user_id, org_id)
      VALUES (${popular}, 2, 1), (${popular}, 3, 1), (${olderTied}, 2, 1), (${newerTied}, 2, 1)`
    await sql`INSERT INTO product_feedback (author_label, body, status, approved_at)
      SELECT 'Sam K · DevRel', 'Filler entry number ' || n || ' with nothing to say.', 'approved', now()::text
      FROM generate_series(1, 201) AS n`

    await page.goto('/dashboard')
    const ids = async (path: string) => {
      const res = await page.request.get(path)
      expect(res.status()).toBe(200)
      return ((await res.json()).feedback as { id: number }[]).map((f) => f.id)
    }
    const newest = await ids('/api/product-feedback')
    expect(newest).toHaveLength(200)
    expect(newest).not.toContain(popular)
    const byVotes = await ids('/api/product-feedback?sort=votes')
    expect(byVotes).toHaveLength(200)
    expect(byVotes.slice(0, 3)).toEqual([popular, newerTied, olderTied])
  })

  test('voting again on an entry you already voted on keeps the same row, answers "added", and wakes open dashboards once', async ({ page }) => {
    const id = await entry(FEEDBACK)
    const dialog = await openBoard(page)
    const action = await captureAction(page, () => upvote(card(dialog, FEEDBACK)).click())
    await expect.poll(async () => (await votesFor(id)).length).toBe(1)
    const [first] = await sql`SELECT id, created_at FROM product_feedback_votes WHERE feedback_id = ${id}`

    // Count the board channel's notifications on a connection of its own, from
    // here on. The no-op update that settles a repeated add still fires the
    // votes trigger, which is the one extra wake-up open dashboards get.
    let wakeUps = 0
    const listener = await sql.listen('product_feedback_changed', () => {
      wakeUps += 1
    })
    try {
      const text = await answer(page, action, { feedbackId: id, voted: true })
      expect(text).toContain(ADDED)
      await expect.poll(() => wakeUps).toBe(1)
      // A round trip after the poll, so a second notification that was still
      // on its way would have arrived by now.
      expect(await votesFor(id)).toHaveLength(1)
      expect(wakeUps).toBe(1)
    } finally {
      await listener.unlisten()
    }

    const [again] = await sql`SELECT id, created_at FROM product_feedback_votes WHERE feedback_id = ${id}`
    expect(again).toEqual(first)
    await expect(upvote(card(dialog, FEEDBACK))).toHaveText('1')
  })

  test('equal counts and equal timestamps still have one fixed order: highest entry id first', async ({ page }) => {
    await seedMember(2, 1)
    const lower = await entry('Tied entry that was written first.')
    const higher = await entry('Tied entry that was written second.')
    // One statement, so now() is the same instant for both rows.
    await sql`UPDATE product_feedback SET created_at = (SELECT (now() - interval '1 minute')::text) WHERE id IN (${lower}, ${higher})`
    await sql`INSERT INTO product_feedback_votes (feedback_id, user_id, org_id) VALUES (${lower}, 2, 1), (${higher}, 2, 1)`
    const [stamps] = await sql`SELECT COUNT(DISTINCT created_at)::int AS n FROM product_feedback WHERE id IN (${lower}, ${higher})`
    expect(stamps.n).toBe(1)

    await page.goto('/dashboard')
    for (const path of ['/api/product-feedback', '/api/product-feedback?sort=votes']) {
      for (let i = 0; i < 3; i++) {
        const res = await page.request.get(path)
        expect(res.status()).toBe(200)
        const ids = ((await res.json()).feedback as { id: number }[]).map((f) => f.id)
        expect(ids, path).toEqual([higher, lower])
      }
    }
  })

  test('running the migrations again over a database that already has the votes table leaves one table, one trigger, one unique constraint, and voting still works', async ({ page }) => {
    await seedMember(2, 1)
    const kept = await entry('An entry whose vote must survive the second run.')
    await sql`INSERT INTO product_feedback_votes (feedback_id, user_id, org_id) VALUES (${kept}, 2, 1)`

    // The runner skips files it has recorded, so forget the votes migrations
    // to make it execute them again over the tables that already exist, the
    // way a database restored without its bookkeeping row would.
    await sql`DELETE FROM __custom_migrations WHERE filename LIKE '0072\_%' OR filename LIKE '0076\_%'`
    await runMigrations()
    await runMigrations()

    const [tables] = await sql`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'product_feedback_votes'`
    expect(tables.n).toBe(1)
    const triggers = await sql`SELECT tgname FROM pg_trigger WHERE tgrelid = 'product_feedback_votes'::regclass AND NOT tgisinternal`
    expect(triggers.map((t) => t.tgname)).toEqual(['trg_product_feedback_votes_changed'])
    const uniques = await sql`SELECT conname FROM pg_constraint WHERE conrelid = 'product_feedback_votes'::regclass AND contype = 'u'`
    expect(uniques.map((c) => c.conname)).toEqual(['product_feedback_votes_unique'])
    // The redundant single-column index is gone after the later migration, and
    // only the primary key and the unique constraint's index remain.
    const indexes = await sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'product_feedback_votes' ORDER BY indexname`
    expect(indexes.map((i) => i.indexname)).toEqual(['product_feedback_votes_pkey', 'product_feedback_votes_unique'])
    expect(await votesFor(kept)).toHaveLength(1)

    // Voting still works end to end, and the trigger still wakes dashboards.
    const id = await entry(FEEDBACK)
    const dialog = await openBoard(page)
    const button = upvote(card(dialog, FEEDBACK))
    await button.click()
    await expect(button).toHaveText('1')
    await expect.poll(async () => (await votesFor(id)).length).toBe(1)
  })
})
