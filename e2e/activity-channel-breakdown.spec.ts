import { randomInt, randomUUID } from 'node:crypto'
import { test as base, expect } from '@playwright/test'
import { encode } from 'next-auth/jwt'
import postgres from 'postgres'

const test = base.extend<{ channelWorkspace: { db: postgres.Sql; orgId: number } }>({
  channelWorkspace: async ({ context, baseURL }, runFixture) => {
    const db = postgres(process.env.DATABASE_URL!, { max: 1 })
    const orgId = randomInt(1_000_000_000, 2_000_000_000)
    const userId = randomInt(1_000_000_000, 2_000_000_000)
    const slug = `channel-test-${randomUUID()}`
    const email = `${slug}@example.test`
    let provisioned = false

    try {
      await db.begin(async (tx) => {
        await tx`INSERT INTO orgs (id, name, slug, onboarded_at)
          VALUES (${orgId}, 'Channel Breakdown Test', ${slug}, now())`
        await tx`INSERT INTO users (id, email, name, provider, terms_accepted_at, terms_version)
          VALUES (${userId}, ${email}, 'Channel Tester', 'test', now(), 'e2e')`
        await tx`INSERT INTO memberships (user_id, org_id, role) VALUES (${userId}, ${orgId}, 'member')`

        // Seed 100 github, 3 discord, 2 slack, 1 email, 1 telegram
        // Total = 107 tickets with unseen customer replies
        const now = new Date()

        // 100 github tickets
        await tx`
          INSERT INTO tickets (org_id, org_ticket_number, source_platform, content, last_customer_reply_at, status)
          SELECT ${orgId}, n, 'github', 'GitHub question ' || n, ${now}::timestamptz, 'open'
          FROM generate_series(1, 100) AS n
        `

        // 3 discord tickets
        await tx`
          INSERT INTO tickets (org_id, org_ticket_number, source_platform, content, last_customer_reply_at, status)
          SELECT ${orgId}, n, 'discord', 'Discord question ' || n, ${now}::timestamptz, 'open'
          FROM generate_series(101, 103) AS n
        `

        // 2 slack tickets
        await tx`
          INSERT INTO tickets (org_id, org_ticket_number, source_platform, content, last_customer_reply_at, status)
          SELECT ${orgId}, n, 'slack', 'Slack question ' || n, ${now}::timestamptz, 'open'
          FROM generate_series(104, 105) AS n
        `

        // 1 email ticket
        await tx`
          INSERT INTO tickets (org_id, org_ticket_number, source_platform, content, last_customer_reply_at, status)
          VALUES (${orgId}, 106, 'email', 'Email question 106', ${now}::timestamptz, 'open')
        `

        // 1 telegram ticket
        await tx`
          INSERT INTO tickets (org_id, org_ticket_number, source_platform, content, last_customer_reply_at, status)
          VALUES (${orgId}, 107, 'telegram', 'Telegram question 107', ${now}::timestamptz, 'open')
        `
      })

      provisioned = true
      const sessionCookie = 'authjs.session-token'
      const value = await encode({
        secret: process.env.AUTH_SECRET!,
        salt: sessionCookie,
        token: { sub: String(userId), userId: String(userId), orgId, name: 'Channel Tester', email },
      })
      await context.addCookies([{ name: sessionCookie, value, url: baseURL!, httpOnly: true }])
      await runFixture({ db, orgId })
    } finally {
      try {
        if (provisioned) {
          await db.begin(async (tx) => {
            await tx`DELETE FROM notifications WHERE org_id = ${orgId}`
            await tx`DELETE FROM tickets WHERE org_id = ${orgId}`
            await tx`DELETE FROM memberships WHERE org_id = ${orgId} AND user_id = ${userId}`
            await tx`DELETE FROM orgs WHERE id = ${orgId} AND slug = ${slug}`
            await tx`DELETE FROM users WHERE id = ${userId} AND email = ${email}`
          })
        }
      } finally {
        await db.end()
      }
    }
  },
})

test.use({ storageState: { cookies: [], origins: [] } })

test('dashboard channel chips and tickets filtering at 375px mobile viewport', async ({ page, channelWorkspace }) => {
  expect(channelWorkspace.orgId).toBeGreaterThan(0)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/dashboard')

  const panel = page.getByRole('region', { name: 'Activity' })
  await expect(panel).toBeVisible()

  // Verify panel starts collapsed
  const toggle = panel.getByRole('button', { name: /Activity/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  // Chips must be visible while collapsed
  const ghChip = panel.getByRole('link', { name: 'GitHub, 100 tickets with new replies' })
  const dcChip = panel.getByRole('link', { name: 'Discord, 3 tickets with new replies' })
  const slChip = panel.getByRole('link', { name: 'Slack, 2 tickets with new replies' })
  const otherChip = panel.getByRole('link', { name: 'Other, 2 tickets with new replies' })

  await expect(ghChip).toBeVisible()
  await expect(dcChip).toBeVisible()
  await expect(slChip).toBeVisible()
  await expect(otherChip).toBeVisible()

  // GitHub count capped at 99+ visually
  await expect(ghChip).toContainText('99+')
  await expect(otherChip).toContainText('2')

  // No horizontal overflow on mobile
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  expect(noOverflow).toBe(true)

  const panelNoOverflow = await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)
  expect(panelNoOverflow).toBe(true)

  // Expand panel -> preview opens and chips stay visible
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(ghChip).toBeVisible()
  await expect(otherChip).toBeVisible()

  // Collapse again
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  // Keyboard navigation: focus the toggle, tab to chips
  await toggle.focus()
  await page.keyboard.press('Tab')
  await expect(ghChip).toBeFocused()

  // Click GitHub chip to navigate to filtered list
  await ghChip.click()
  await expect(page).toHaveURL(/\/tickets\?newActivity=1&sort=activity&platform=github/)

  // Verify tickets page filter state
  const channelSelect = page.getByRole('combobox', { name: 'Filter by channel' })
  await expect(channelSelect).toHaveValue('github')
  const newActivityCheckbox = page.getByRole('checkbox', { name: 'New activity' })
  await expect(newActivityCheckbox).toBeChecked()

  // Verify actual filtered ticket results
  await expect(page.getByText('GitHub question').first()).toBeVisible()
  await expect(page.getByText('Discord question')).toHaveCount(0)
  await expect(page.getByText('Slack question')).toHaveCount(0)
})

test('dashboard channel chips and tickets filtering at 1280px desktop viewport', async ({ page, channelWorkspace }) => {
  expect(channelWorkspace.orgId).toBeGreaterThan(0)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/dashboard')

  const panel = page.getByRole('region', { name: 'Activity' })
  await expect(panel).toBeVisible()

  // Other chip links to unfiltered new activity list
  const otherChip = panel.getByRole('link', { name: 'Other, 2 tickets with new replies' })
  await expect(otherChip).toBeVisible()
  await otherChip.click()

  await expect(page).toHaveURL(/\/tickets\?newActivity=1&sort=activity/)
  const channelSelect = page.getByRole('combobox', { name: 'Filter by channel' })
  await expect(channelSelect).toHaveValue('')

  // Verify unfiltered results show tickets from multiple channels
  await expect(page.getByText('Discord question').first()).toBeVisible()

  // Filter by channel using the tickets page dropdown
  await channelSelect.selectOption('discord')
  await page.getByRole('button', { name: 'Filter' }).click()
  await expect(page).toHaveURL(/\/tickets.*platform=discord/)
  await expect(channelSelect).toHaveValue('discord')

  // Verify filtered results contain only Discord tickets
  await expect(page.getByText('Discord question').first()).toBeVisible()
  await expect(page.getByText('GitHub question')).toHaveCount(0)
  await expect(page.getByText('Slack question')).toHaveCount(0)
})
