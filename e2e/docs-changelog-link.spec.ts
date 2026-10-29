import { test, expect } from '@playwright/test'

// The docs through a real server. The e2e deployment is self-hosted, which
// serves no /changelog, so this covers the "no link" side end to end and the
// docs at phone width. The side that shows the link (the managed deployment)
// is covered by docs-layout-changelog.test.tsx, which runs the real layout, and
// docs-sidebar-footer.test.tsx for how it renders.

const PAGE = '/docs/introduction'

test.describe('docs on a deployment with no marketing site', () => {
  test('load, and show no Changelog link anywhere, so there is no dead link', async ({ page }) => {
    const res = await page.goto(PAGE)
    expect(res?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'What is answerLoops?' })).toBeVisible()
    expect(await page.getByRole('link', { name: 'Changelog' }).count()).toBe(0)
    expect(await page.locator('a[href*="/changelog"]').count()).toBe(0)
  })

  test('keep the sign-in and start entries in the header', async ({ page }) => {
    await page.goto(PAGE)
    await expect(page.getByRole('link', { name: 'Log in' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Start trial' }).first()).toBeVisible()
  })
})

test.describe('docs at 375px', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('do not scroll sideways, closed or with the navigation open', async ({ page }) => {
    await page.goto(PAGE)
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(await overflow()).toBeLessThanOrEqual(0)

    await page.getByRole('button', { name: /open sidebar|menu|toggle/i }).first().click()
    await expect(page.getByRole('link', { name: 'Log in' }).filter({ visible: true }).first()).toBeVisible()
    expect(await overflow()).toBeLessThanOrEqual(0)
  })
})
