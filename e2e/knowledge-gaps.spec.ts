import { test, expect } from '@playwright/test'
import { ingest, waitForPipeline, waitForTicketField } from './helpers'

// Knowledge gaps page: resolved how-to tickets not yet in KB appear as gaps.
// Promoting to KB removes them from the list.

test.describe('knowledge gaps page', () => {
  test('resolved how-to ticket appears as a gap', async ({ request, page }) => {
    const ticketId = await ingest(request, { content: 'How do I configure the client connection?' })
    await waitForPipeline(request, ticketId)

    // Resolve via ticket detail
    await page.goto(`/tickets/${ticketId}`)
    const statusForm = page.locator('form:has(select[name="status"])')
    await statusForm.locator('input[name="staffName"]').fill('Sarah')
    await statusForm.locator('select[name="status"]').selectOption('resolved')
    await statusForm.getByRole('button', { name: 'Update status' }).click()
    await expect(page.getByText(/open → resolved/)).toBeVisible()
    await waitForTicketField(request, ticketId, 'status', 'resolved')

    await page.goto('/knowledge-gaps')
    await expect(page.getByRole('heading', { name: /knowledge gap/i })).toBeVisible()
    await expect(page.getByText(/configure the client/i).first()).toBeVisible()
  })

  test('gap links to ticket detail', async ({ request, page }) => {
    const ticketId = await ingest(request, { content: 'How do I configure the client connection?' })
    await waitForPipeline(request, ticketId)

    await page.goto(`/tickets/${ticketId}`)
    const statusForm = page.locator('form:has(select[name="status"])')
    await statusForm.locator('input[name="staffName"]').fill('Sarah')
    await statusForm.locator('select[name="status"]').selectOption('resolved')
    await statusForm.getByRole('button', { name: 'Update status' }).click()
    await waitForTicketField(request, ticketId, 'status', 'resolved')

    await page.goto('/knowledge-gaps')
    // Click the link to the ticket
    await page.getByRole('link', { name: /configure the client/i }).first().click()
    await expect(page).toHaveURL(new RegExp(`/tickets/${ticketId}`))
  })

  test('promoting gap to KB removes it from the list', async ({ request, page }) => {
    const ticketId = await ingest(request, { content: 'How do I configure the client connection?' })
    await waitForPipeline(request, ticketId)

    await page.goto(`/tickets/${ticketId}`)
    const statusForm = page.locator('form:has(select[name="status"])')
    await statusForm.locator('input[name="staffName"]').fill('Sarah')
    await statusForm.locator('select[name="status"]').selectOption('resolved')
    await statusForm.getByRole('button', { name: 'Update status' }).click()
    await expect(page.getByText(/open → resolved/)).toBeVisible()
    await waitForTicketField(request, ticketId, 'status', 'resolved')

    await page.goto(`/tickets/${ticketId}`)
    await page.getByRole('button', { name: 'Promote to KB' }).click()
    await expect(page.getByText('✓ In knowledge base')).toBeVisible()

    await page.goto('/knowledge-gaps')
    // The promoted ticket should no longer appear. Scoped to this ticket's
    // own link rather than matching on content text: other tests in this
    // suite ingest the same wording and leave their tickets resolved-but-
    // unpromoted, so a text match alone can still find gap links left over
    // from them.
    await expect(page.locator(`a[href="/tickets/${ticketId}"]`)).toHaveCount(0)
  })
})
