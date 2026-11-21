import { test, expect } from '@playwright/test'
import { encode } from 'next-auth/jwt'
import postgres from 'postgres'

for (const width of [375, 1440]) {
  test(`clears dashboard activity, tickets, and notifications at ${width}px`, async ({ page, context }) => {
    const db = postgres(process.env.DATABASE_URL!, { max: 1 })
    const orgId = 619_000 + width
    try {
      await db.begin(async (tx) => {
        await tx`INSERT INTO orgs (id, name, slug, onboarded_at)
          VALUES (${orgId}, 'Activity test workspace', ${`activity-${width}`}, now())`
        await tx`INSERT INTO memberships (user_id, org_id, role) VALUES (1, ${orgId}, 'member')`
        await tx`WITH seeded AS (
          INSERT INTO tickets (org_id, org_ticket_number, content, last_customer_reply_at)
          SELECT ${orgId}, n, 'Bulk activity ticket ' || n, clock_timestamp()
          FROM generate_series(1, 6) AS n RETURNING id
        )
        INSERT INTO notifications (org_id, ticket_id, type, message)
        SELECT ${orgId}, id, 'ticket_activity', 'A customer replied' FROM seeded`
      })
      const sessionCookie = 'authjs.session-token'
      const value = await encode({
        secret: process.env.AUTH_SECRET!,
        salt: sessionCookie,
        token: { sub: '1', userId: '1', orgId, name: 'Test Staff', email: 'staff@example.com' },
      })
      await context.addCookies([{ name: sessionCookie, value, url: 'http://localhost:3100', httpOnly: true }])

      await page.setViewportSize({ width, height: 900 })
      await page.goto('/dashboard')
      const panel = page.getByRole('region', { name: 'Activity' })
      const trigger = panel.getByRole('button', { name: 'Mark all as seen' })
      await expect(trigger).toBeHidden()
      await expect(page.getByRole('button', { name: 'Notifications, 6 unread' })).toBeVisible()
      await panel.getByRole('button', { name: 'Activity, 6 tickets with new customer replies' }).click()
      await expect(panel.getByRole('listitem')).toHaveCount(5)
      await trigger.click()
      const confirmation = panel.getByRole('group', { name: 'Mark 6 tickets as seen?' })
      await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused()
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      await page.keyboard.press('Escape')
      await expect(confirmation).toBeHidden()
      await expect(trigger).toBeFocused()

      await trigger.click()
      await confirmation.getByRole('button', { name: 'Confirm mark all as seen' }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Marked 6 tickets as seen.' })).toBeVisible()
      await expect(panel).toBeHidden()
      await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible()
      await page.getByRole('link', { name: 'View all tickets', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Tickets', exact: true })).toBeVisible()
      await expect(page.getByText('Bulk activity ticket 1', { exact: true })).toBeVisible()
      await expect(page.getByRole('table').getByText('New activity', { exact: true })).toHaveCount(0)
      await page.goto('/tickets?newActivity=1&sort=activity')
      await expect(page.getByRole('heading', { name: 'Tickets', exact: true })).toBeVisible()
      await expect(page.getByText('No tickets found.', { exact: true })).toBeVisible()
      const [row] = await db<{ open: number }[]>`
        SELECT count(*)::int AS open FROM tickets WHERE org_id = ${orgId} AND status = 'open'
      `
      expect(row.open).toBe(6)
    } finally {
      await db.end()
    }
  })
}
