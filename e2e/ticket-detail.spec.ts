import { test, expect } from '@playwright/test'
import { ingest, waitForPipeline, ticketDetailPath } from './helpers'

// Exercises the server actions reachable from the ticket detail page: staff
// feedback vote, AI draft approval, and a status update.
test.describe('ticket detail interactions', () => {
  test('staff can thumbs-up the AI answer', async ({ request, page }) => {
    const ticketId = await ingest(request, { content: 'How do I configure the client?' })
    await waitForPipeline(request, ticketId)

    await page.goto(await ticketDetailPath(request, ticketId))
    await page.getByRole('button', { name: '👍' }).click()

    await expect(page.getByText('your vote counted')).toBeVisible()
    await expect(page.getByText('1 up · 0 down')).toBeVisible()
  })

  test('staff can approve the AI draft', async ({ request, page }) => {
    const ticketId = await ingest(request, { content: 'How do I configure the client?' })
    await waitForPipeline(request, ticketId)

    await page.goto(await ticketDetailPath(request, ticketId))
    await page.getByRole('button', { name: 'Approve' }).click()

    // The panel re-renders (server action + refresh) showing the approved state.
    await expect(page.getByText('Approved', { exact: true })).toBeVisible()
    await expect(page.getByText('AI approved')).toBeVisible()
  })

  test('staff can resolve a ticket', async ({ request, page }) => {
    const ticketId = await ingest(request, { content: 'How do I configure the client?' })
    await waitForPipeline(request, ticketId)

    await page.goto(await ticketDetailPath(request, ticketId))
    // staffName appears in both the status and reply forms — scope to the
    // status form (the one with the status select).
    const statusForm = page.locator('form:has(select[name="status"])')
    await statusForm.locator('input[name="staffName"]').fill('Sarah')
    await statusForm.locator('select[name="status"]').selectOption('resolved')
    await statusForm.getByRole('button', { name: 'Update status' }).click()

    // The page re-renders with an activity entry recording the transition.
    await expect(page.getByText(/open → resolved/)).toBeVisible()
  })
})
