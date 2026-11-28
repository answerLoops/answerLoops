import fs from 'fs'
import postgres from 'postgres'
import { test, expect, type Page } from '@playwright/test'
import { WIDGET_TOKEN_FILE } from './global-setup'
import { DEFAULT_ORG_ID } from '../lib/db/schema'

// A reply that does not come through, in a real browser: the first chat
// request is answered with a 503 by the test, the visitor sees plain words and
// Retry (never the server's text), Retry gets the real (mocked-AI) answer with
// the question shown once, and the question survives a reload. Loaded with a
// customer referrer, as an embed is.

const CUSTOMER_SITE = 'https://customer.example/help'
const SERVER_TEXT = 'Upstream model gateway timed out'
const sql = postgres(process.env.DATABASE_URL!, { max: 1 })
let previous: { widget_allowed_origins: string | null; widget_lead_capture_mode: string } | null = null

test.beforeAll(async () => {
  const [row] = await sql`select widget_allowed_origins, widget_lead_capture_mode from orgs where id = ${DEFAULT_ORG_ID}`
  previous = row as typeof previous
  await sql`update orgs set widget_allowed_origins = 'customer.example', widget_lead_capture_mode = 'off' where id = ${DEFAULT_ORG_ID}`
})

test.afterAll(async () => {
  if (previous) {
    await sql`update orgs set widget_allowed_origins = ${previous.widget_allowed_origins}, widget_lead_capture_mode = ${previous.widget_lead_capture_mode} where id = ${DEFAULT_ORG_ID}`
  }
  await sql.end()
})

function token(): string {
  return (JSON.parse(fs.readFileSync(WIDGET_TOKEN_FILE, 'utf-8')) as { token: string }).token
}

/**
 * Answers the first `failures` reply requests with a 503; later ones reach the
 * server. Only replies (`agent/run`) are failed: the chat endpoint also serves
 * the client's own setup call (`info`), which is left alone.
 */
async function failFirst(page: Page, failures = 1) {
  let left = failures
  await page.route('**/api/widget/chat', async (route) => {
    const isReply = (route.request().postData() ?? '').includes('"method":"agent/run"')
    if (isReply && left > 0) {
      left--
      await route.fulfill({ status: 503, contentType: 'text/plain', body: SERVER_TEXT })
      return
    }
    await route.continue()
  })
}

async function open(page: Page) {
  await page.goto(`/widget/${token()}`, { referer: CUSTOMER_SITE })
  await expect(page.getByPlaceholder('Ask a question…')).toBeVisible()
}

async function ask(page: Page, text: string) {
  await page.getByPlaceholder('Ask a question…').fill(text)
  await page.getByPlaceholder('Ask a question…').press('Enter')
}

const QUESTION = 'How do I export my data?'

test.describe('widget: a reply that does not come through', () => {
  test('shows plain words and Retry, never the server text; Retry gets the answer and the question appears once', async ({ page }) => {
    await failFirst(page)
    await open(page)
    await ask(page, QUESTION)

    const failed = page.getByTestId('reply-failed')
    await expect(failed).toBeVisible()
    await expect(failed).toContainText("We're a little busy right now")
    await expect(page.getByText(SERVER_TEXT)).toHaveCount(0)
    await expect(page.getByText(/503/)).toHaveCount(0)

    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByRole('button', { name: 'Copy reply' }).first()).toBeAttached({ timeout: 30_000 })
    await expect(failed).toHaveCount(0)
    await expect(page.getByText(QUESTION, { exact: true })).toHaveCount(1)
  })

  test('says the visitor is offline when the connection is gone', async ({ page, context }) => {
    await open(page)
    await context.setOffline(true)
    await ask(page, QUESTION)
    await expect(page.getByTestId('reply-failed')).toContainText("It looks like you're offline")
    await context.setOffline(false)
  })

  test('the question survives a reload while the error shows, with Retry still offered', async ({ page }) => {
    await failFirst(page)
    await open(page)
    await ask(page, QUESTION)
    await expect(page.getByTestId('reply-failed')).toBeVisible()

    // Load the chat again the way the embed does (with the host page as referrer).
    await page.goto(`/widget/${token()}`, { referer: CUSTOMER_SITE })
    await expect(page.getByText(QUESTION, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByRole('button', { name: 'Copy reply' }).first()).toBeAttached({ timeout: 30_000 })
    await expect(page.getByText(QUESTION, { exact: true })).toHaveCount(1)
  })
})

test.describe('widget: the failure bubble on a phone', () => {
  test.use({ viewport: { width: 375, height: 700 }, hasTouch: true, isMobile: true })

  test('Retry is tap-sized and nothing overflows', async ({ page }) => {
    await failFirst(page)
    await open(page)
    await ask(page, QUESTION)
    const retry = page.getByRole('button', { name: 'Retry' })
    await expect(retry).toBeVisible()
    expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: 'test-results/widget-retry-375.png' })
  })
})
