import fs from 'fs'
import postgres from 'postgres'
import { test, expect, type Page } from '@playwright/test'
import { WIDGET_TOKEN_FILE } from './global-setup'
import { DEFAULT_ORG_ID } from '../lib/db/schema'

// The Copy button under widget replies, in a real browser with a real
// (mocked-AI) answer: always visible and tap-sized on a phone, revealed on
// hover with a mouse, and copying the reply as plain text to the clipboard.

// The widget only loads on the workspace's allowed domains, so the test
// workspace allows the stand-in customer site for these tests, and gets its
// previous setting back afterwards.
const CUSTOMER_SITE = 'https://customer.example/help'
const sql = postgres(process.env.DATABASE_URL!, { max: 1 })
let previousOrigins: string | null = null

test.beforeAll(async () => {
  const [row] = await sql`select widget_allowed_origins from orgs where id = ${DEFAULT_ORG_ID}`
  previousOrigins = (row?.widget_allowed_origins as string | null) ?? null
  await sql`update orgs set widget_allowed_origins = 'customer.example' where id = ${DEFAULT_ORG_ID}`
})

test.afterAll(async () => {
  await sql`update orgs set widget_allowed_origins = ${previousOrigins} where id = ${DEFAULT_ORG_ID}`
  await sql.end()
})

function token(): string {
  return (JSON.parse(fs.readFileSync(WIDGET_TOKEN_FILE, 'utf-8')) as { token: string }).token
}

async function askAndWaitForReply(page: Page) {
  // A real embed sends the host page as its referrer; without one the widget
  // cannot tell which site it is on and refuses to load.
  await page.goto(`/widget/${token()}`, { referer: CUSTOMER_SITE })
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.getByPlaceholder('Ask a question…').fill('How do I export my data?')
  await page.getByPlaceholder('Ask a question…').press('Enter')
  const copy = page.getByRole('button', { name: 'Copy reply' }).first()
  await expect(copy).toBeAttached({ timeout: 30_000 })
  return copy
}

async function opacity(page: Page, testId: string): Promise<number> {
  return page.getByTestId(testId).first().evaluate((el) => Number(getComputedStyle(el).opacity))
}

async function clipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText())
}

test.describe('widget: copy a reply on a phone', () => {
  test.use({ viewport: { width: 375, height: 700 }, hasTouch: true, isMobile: true, permissions: ['clipboard-read', 'clipboard-write'] })

  test('the button is always visible, tap-sized, fits the screen and copies plain text', async ({ page }) => {
    const copy = await askAndWaitForReply(page)
    await expect(copy).toBeVisible()
    expect(await opacity(page, 'copy-reply')).toBe(1)
    const box = (await copy.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: 'test-results/widget-copy-reply-375.png' })

    await copy.tap()
    await expect(copy).toHaveText('Copied')
    const copied = await clipboardText(page)
    expect(copied.length).toBeGreaterThan(0)
    expect(copied).not.toMatch(/\*\*|`|\]\(/)
  })
})

test.describe('widget: copy a reply with a mouse', () => {
  test.use({ viewport: { width: 420, height: 700 }, permissions: ['clipboard-read', 'clipboard-write'] })

  test('the button is hidden until the reply is hovered, then copies plain text', async ({ page }) => {
    const copy = await askAndWaitForReply(page)
    // Wait for the reply to finish so the button's resting state is settled.
    await page.mouse.move(0, 0)
    await expect.poll(() => opacity(page, 'copy-reply')).toBe(0)

    await copy.locator('xpath=ancestor::div[contains(@class,"group")][1]').hover()
    await expect.poll(() => opacity(page, 'copy-reply')).toBe(1)
    await copy.click()
    await expect(copy).toHaveText('Copied')
    expect(await clipboardText(page)).not.toMatch(/\*\*|`|\]\(/)
  })

  test('keyboard focus reveals it too', async ({ page }) => {
    const copy = await askAndWaitForReply(page)
    await page.mouse.move(0, 0)
    await copy.focus()
    await expect.poll(() => opacity(page, 'copy-reply')).toBe(1)
  })
})
