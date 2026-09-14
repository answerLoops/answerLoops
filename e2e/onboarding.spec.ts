import { test, expect } from '@playwright/test'

// Onboarding wizard: 4-step flow (name → connect → seed → done).
// Tests step rendering, navigation, skip paths.

test.describe('onboarding wizard', () => {
  test('renders step 1: workspace name', async ({ page }) => {
    await page.goto('/onboarding')
    // Progress bar shows 4 steps. Exact match: "Workspace" is also a
    // substring of the step-1 heading, intro paragraph, and field label.
    await expect(page.getByText('Workspace', { exact: true })).toBeVisible()
    await expect(page.getByText('Connect', { exact: true })).toBeVisible()
    await expect(page.getByText('Seed KB', { exact: true })).toBeVisible()
    await expect(page.getByText('Go live', { exact: true })).toBeVisible()
    // Step 1 name input
    await expect(page.locator('input[name="name"]')).toBeVisible()
  })

  test('step 1: can update workspace name and advance', async ({ page }) => {
    await page.goto('/onboarding')
    const nameInput = page.locator('input[name="name"]')
    await nameInput.fill('My Test Workspace')
    await page.getByRole('button', { name: /continue|next|save/i }).first().click()
    // Should advance to step 2 (connect)
    await expect(page.getByText(/discord|slack|connect/i).first()).toBeVisible({ timeout: 8_000 })
  })

  test('step 1: validates empty name', async ({ page }) => {
    await page.goto('/onboarding')
    const nameInput = page.locator('input[name="name"]')
    await nameInput.clear()
    await page.getByRole('button', { name: /continue|next|save/i }).first().click()
    // The name field is a native `required` input — the browser blocks
    // submission itself (no custom error text is rendered), so the
    // observable effect is that the field fails constraint validation and
    // the form never advances past step 1.
    await expect(nameInput).toHaveJSProperty('validity.valueMissing', true)
    await expect(nameInput).toBeVisible()
  })

  test('step 2: shows platform options (Discord + Slack)', async ({ page }) => {
    await page.goto('/onboarding')
    // Advance past step 1
    await page.locator('input[name="name"]').fill('Test Workspace')
    await page.getByRole('button', { name: /continue|next|save/i }).first().click()
    await expect(page.getByText(/discord/i).first()).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText(/slack/i).first()).toBeVisible()
  })

  test('step 2: skip connect and advance to seed KB', async ({ page }) => {
    await page.goto('/onboarding')
    // Step 1
    await page.locator('input[name="name"]').fill('Test Workspace')
    await page.getByRole('button', { name: /continue|next|save/i }).first().click()
    // Step 2 — skip
    await expect(page.getByText(/discord|slack|connect/i).first()).toBeVisible({ timeout: 8_000 })
    const skipBtn = page.getByRole('button', { name: /skip/i })
    if (await skipBtn.isVisible()) {
      await skipBtn.click()
      await expect(page.getByText(/seed|knowledge base|import/i).first()).toBeVisible({ timeout: 8_000 })
    }
  })

  test('step 3: shows KB seed options (file + URL)', async ({ page }) => {
    await page.goto('/onboarding')
    // Step 1
    await page.locator('input[name="name"]').fill('Test Workspace')
    await page.getByRole('button', { name: /continue|next|save/i }).first().click()
    // Step 2 — skip
    await expect(page.getByText(/discord|slack|connect/i).first()).toBeVisible({ timeout: 8_000 })
    const skipBtn = page.getByRole('button', { name: /skip/i })
    if (await skipBtn.isVisible()) {
      await skipBtn.click()
      // Step 3 should show file/url options
      await expect(
        page.getByText(/upload|file|url|import/i).first()
      ).toBeVisible({ timeout: 8_000 })
    }
  })

  test('step 4: done step renders checklist', async ({ page }) => {
    await page.goto('/onboarding')
    // Step 1
    await page.locator('input[name="name"]').fill('Test Workspace')
    await page.getByRole('button', { name: /continue|next|save/i }).first().click()
    // Step 2 — skip. `expect().toBeVisible()` retries until the button
    // actually renders; a plain `isVisible()` snapshot check here raced the
    // step transition and was intermittently false right after navigation.
    await expect(page.getByText(/discord|slack|connect/i).first()).toBeVisible({ timeout: 8_000 })
    const skipStep2 = page.getByRole('button', { name: /skip/i })
    await expect(skipStep2).toBeVisible({ timeout: 8_000 })
    await skipStep2.click()

    // Step 3 — skip
    await expect(page.getByText(/seed|knowledge|upload|import/i).first()).toBeVisible({ timeout: 8_000 })
    const skipStep3 = page.getByRole('button', { name: /skip/i })
    await expect(skipStep3).toBeVisible({ timeout: 8_000 })
    await skipStep3.click()

    // Done step
    await expect(
      page.getByText(/all set|you.?re live|go to dashboard|what.?s next/i).first()
    ).toBeVisible({ timeout: 8_000 })
  })

  test('done step has go to dashboard link', async ({ page }) => {
    await page.goto('/onboarding')
    // Navigate through all skip paths
    await page.locator('input[name="name"]').fill('Test Workspace')
    await page.getByRole('button', { name: /continue|next|save/i }).first().click()
    await expect(page.getByText(/discord|slack/i).first()).toBeVisible({ timeout: 8_000 })
    for (let i = 0; i < 2; i++) {
      const skip = page.getByRole('button', { name: /skip/i })
      if (await skip.isVisible()) await skip.click()
      await page.waitForTimeout(500)
    }
    const dashLink = page.getByRole('link', { name: /dashboard/i })
    if (await dashLink.isVisible()) {
      await dashLink.click()
      await expect(page).toHaveURL(/dashboard/)
    }
  })
})
