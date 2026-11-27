import fs from 'fs'
import postgres from 'postgres'
import { test, expect, type Page } from '@playwright/test'
import { WIDGET_TOKEN_FILE } from './global-setup'
import { DEFAULT_ORG_ID } from '../lib/db/schema'

// The widget's question box in a real browser, embedded the way customers
// embed it: a stand-in customer page loads public/widget.js, and opening the
// bubble opens the real chat in its frame. Checks the cursor on open (mouse
// only), the box growing and sending, and the unsent question surviving a
// close and a page reload.

// A stand-in customer site, and the app under test behind its own name. The
// browser would refuse a page served from here to load anything from the real
// http://localhost server, so every request to APP is forwarded to the server
// by the test, with the browser's own headers (its Referer included). To the
// browser it is a customer page embedding the widget from another site, which
// is what a real embed is. The allowed-domains check uses the host name only.
const CUSTOMER_HOST = 'customer.localhost'
const CUSTOMER_PAGE = `http://${CUSTOMER_HOST}/help`
const APP = 'http://app.localhost'
const sql = postgres(process.env.DATABASE_URL!, { max: 1 })
let previous: { widget_allowed_origins: string | null; widget_lead_capture_mode: string } | null = null

// The test workspace allows the stand-in site, and skips the up-front email
// screen so the chat opens straight onto the question box. Both are put back.
test.beforeAll(async () => {
  const [row] = await sql`select widget_allowed_origins, widget_lead_capture_mode from orgs where id = ${DEFAULT_ORG_ID}`
  previous = row as typeof previous
  await sql`update orgs set widget_allowed_origins = ${CUSTOMER_HOST}, widget_lead_capture_mode = 'off' where id = ${DEFAULT_ORG_ID}`
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

/** Serves a customer page that embeds the widget from this app, then opens it. */
async function openCustomerPage(page: Page, baseURL: string) {
  await page.route(`${APP}/**`, async (route) => {
    const url = new URL(route.request().url())
    try {
      const response = await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` })
      await route.fulfill({ response })
    } catch {
      // A streamed answer still arriving when the test finishes; nothing to forward.
    }
  })
  await page.route(CUSTOMER_PAGE, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Help</h1><script src="${APP}/widget.js" data-widget-id="${token()}" data-base-url="${APP}"></script></body></html>`,
    })
  )
  await page.goto(CUSTOMER_PAGE)
}

async function openChat(page: Page) {
  await page.locator('#cp-widget-bubble').click()
  const chat = page.frameLocator('#cp-widget-panel iframe')
  const box = chat.getByRole('textbox', { name: 'Your question' })
  await expect(box).toBeVisible({ timeout: 30_000 })
  return { chat, box }
}

test.describe('widget question box with a mouse', () => {
  test('the cursor is in the box when the chat opens, and again when it is reopened', async ({ page, baseURL }) => {
    await openCustomerPage(page, baseURL!)
    const { box } = await openChat(page)
    await expect(box).toBeFocused()

    await page.locator('#cp-widget-bubble').click() // close
    await page.locator('h1').click()
    await page.locator('#cp-widget-bubble').click() // reopen
    await expect(box).toBeFocused()
  })

  test('Shift+Enter adds a line, the box grows, and Enter sends', async ({ page, baseURL }) => {
    await openCustomerPage(page, baseURL!)
    const { chat, box } = await openChat(page)
    const oneLine = (await box.boundingBox())!.height
    await box.type('First line')
    await box.press('Shift+Enter')
    await box.type('Second line')
    expect(await box.inputValue()).toBe('First line\nSecond line')
    expect((await box.boundingBox())!.height).toBeGreaterThan(oneLine)

    await box.press('Enter')
    await expect(chat.getByText('Second line')).toBeVisible()
    await expect(box).toHaveValue('')
    // Back to one line (within a pixel: the browser rounds the measured height).
    expect(Math.abs((await box.boundingBox())!.height - oneLine)).toBeLessThan(1)
  })

  test('a half-typed question survives closing the chat and reloading the page', async ({ page, baseURL }) => {
    await openCustomerPage(page, baseURL!)
    const { box } = await openChat(page)
    await box.type('How do I export my')
    await page.locator('#cp-widget-bubble').click() // close
    await page.reload()
    const reopened = await openChat(page)
    await expect(reopened.box).toHaveValue('How do I export my')
  })
})

test.describe('widget question box on a phone', () => {
  test.use({ viewport: { width: 375, height: 700 }, hasTouch: true, isMobile: true })

  test('does not focus the box on open, is tap-sized with 16px text, and fits the screen', async ({ page, baseURL }) => {
    await openCustomerPage(page, baseURL!)
    const { chat, box } = await openChat(page)
    await expect(box).not.toBeFocused()

    const fontSize = await box.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
    expect(fontSize).toBeGreaterThanOrEqual(16)
    expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect((await chat.getByRole('button', { name: 'Send message' }).boundingBox())!.height).toBeGreaterThanOrEqual(44)

    const frame = page.frame({ url: /\/widget\// })!
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: 'test-results/widget-question-box-375.png' })
  })
})
