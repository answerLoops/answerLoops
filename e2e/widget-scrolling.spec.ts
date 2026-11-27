import fs from 'fs'
import postgres from 'postgres'
import { test, expect, type Page } from '@playwright/test'
import { WIDGET_TOKEN_FILE } from './global-setup'
import { DEFAULT_ORG_ID } from '../lib/db/schema'

// Scrolling in the real widget with a real (mocked-AI) reply. The chat starts
// from a long restored conversation, so there is something to scroll: a
// visitor at the bottom follows the reply, a visitor who scrolled up stays put
// and gets "Jump to latest", and the phone layout keeps the button clear of the
// question box. Loaded with a customer referrer, as an embed is.

const CUSTOMER_SITE = 'https://customer.example/help'
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

/** Opens the chat with a long earlier conversation already in it. */
async function openLongChat(page: Page) {
  const t = token()
  const messages = Array.from({ length: 12 }, (_, i) => [
    { id: `u${i}`, role: 'user', content: `Earlier question ${i + 1}` },
    { id: `a${i}`, role: 'assistant', content: `Earlier answer ${i + 1}. `.repeat(6) },
  ]).flat()
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [`al_chat:${t}`, JSON.stringify({ v: 1, savedAt: Date.now(), messages })]
  )
  await page.goto(`/widget/${t}`, { referer: CUSTOMER_SITE })
  const thread = page.getByTestId('chat-thread')
  await expect(page.getByText('Earlier question 12')).toBeVisible()
  return thread
}

/**
 * Holds each chat reply back for a moment, so the test can scroll up while it
 * is still on its way. The reply itself is the server's, unchanged.
 */
async function slowReplies(page: Page) {
  await page.route('**/api/widget/chat', async (route) => {
    try {
      const response = await route.fetch()
      await new Promise((r) => setTimeout(r, 1500))
      await route.fulfill({ response })
    } catch {
      // The test finished while a reply was still held back.
    }
  })
}

async function distanceFromBottom(page: Page): Promise<number> {
  return page.getByTestId('chat-thread').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)
}

async function ask(page: Page, text: string) {
  await page.getByPlaceholder('Ask a question…').fill(text)
  await page.getByPlaceholder('Ask a question…').press('Enter')
}

test.describe('widget scrolling', () => {
  test('starts at the newest message and follows the reply while the visitor is at the bottom', async ({ page }) => {
    await openLongChat(page)
    await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(2)
    await ask(page, 'How do I export my data?')
    await expect(page.getByRole('button', { name: 'Copy reply' }).last()).toBeAttached({ timeout: 30_000 })
    await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(2)
    await expect(page.getByRole('button', { name: 'Jump to latest' })).toHaveCount(0)
  })

  test('a visitor who scrolled up stays put; Jump to latest takes them down and goes away', async ({ page }) => {
    await slowReplies(page)
    const thread = await openLongChat(page)
    await ask(page, 'How do I export my data?')
    // Scroll up while the reply is on its way.
    await thread.evaluate((el) => {
      el.dispatchEvent(new WheelEvent('wheel'))
      el.scrollTop = 0
    })
    await expect(page.getByRole('button', { name: 'Copy reply' }).last()).toBeAttached({ timeout: 30_000 })
    expect(await thread.evaluate((el) => el.scrollTop)).toBeLessThan(50)

    const jump = page.getByRole('button', { name: 'Jump to latest' })
    await expect(jump).toBeVisible()
    await jump.click()
    await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(2)
    await expect(jump).toHaveCount(0)
  })

  test('the typing dots fade, and do not animate at all with reduced motion', async ({ page }) => {
    await slowReplies(page)
    await openLongChat(page)
    await ask(page, 'How do I export my data?')
    const dot = page.getByTestId('typing-indicator').locator('[aria-hidden="true"] > span').first()
    await expect(dot).toBeVisible()
    expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).toBe('pulse')

    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  })
})

test.describe('widget scrolling on a phone', () => {
  test.use({ viewport: { width: 375, height: 700 }, hasTouch: true, isMobile: true })

  test('Jump to latest sits above the question box without covering it, and nothing overflows', async ({ page }) => {
    await slowReplies(page)
    const thread = await openLongChat(page)
    await ask(page, 'How do I export my data?')
    await thread.evaluate((el) => {
      el.dispatchEvent(new TouchEvent('touchstart'))
      el.scrollTop = 0
    })
    await expect(page.getByRole('button', { name: 'Copy reply' }).last()).toBeAttached({ timeout: 30_000 })
    const jump = page.getByRole('button', { name: 'Jump to latest' })
    await expect(jump).toBeVisible()

    const button = (await jump.boundingBox())!
    const box = (await page.getByPlaceholder('Ask a question…').boundingBox())!
    expect(button.y + button.height).toBeLessThanOrEqual(box.y)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: 'test-results/widget-jump-to-latest-375.png' })
  })
})
