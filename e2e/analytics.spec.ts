import { test, expect } from '@playwright/test'
import { ingest, waitForPipeline, waitForTicketField, ticketDetailPath } from './helpers'

interface Analytics {
  stats: { totalTickets: number; answered: number; deflected: number }
  rate: number
  savings: { deflected: number; hoursSaved: number; dollarsSaved: number }
  docGaps: Array<{ id: number }>
}

const getAnalytics = async (request: import('@playwright/test').APIRequestContext): Promise<Analytics> =>
  request.get('/api/analytics').then((r) => r.json())

test.describe('analytics / ROI', () => {
  test('deflected answers produce savings and a deflection rate', async ({ request }) => {
    const confident1 = await ingest(request, { content: 'How do I configure the client connection?' })
    const confident2 = await ingest(request, { content: 'How do I authenticate the client?' })
    const unsure = await ingest(request, { content: 'Something odd is happening [[needhuman]]' })
    for (const id of [confident1, confident2, unsure]) await waitForPipeline(request, id)

    const a = await getAnalytics(request)
    expect(a.stats.answered).toBeGreaterThanOrEqual(3)
    expect(a.stats.deflected).toBeGreaterThanOrEqual(2)
    expect(a.rate).toBeGreaterThan(0)
    expect(a.rate).toBeLessThanOrEqual(1)
    expect(a.savings.hoursSaved).toBeGreaterThan(0)
    expect(a.savings.dollarsSaved).toBeGreaterThan(0)
  })

  test('the analytics page renders the ROI hero', async ({ page }) => {
    await page.goto('/analytics')
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible()
    await expect(page.getByText('Staff time saved')).toBeVisible()
    await expect(page.getByText('Deflection rate')).toBeVisible()
  })

  test('a resolved how-to is a doc gap until promoted to KB', async ({ request, page }) => {
    const ticketId = await ingest(request, { content: 'How do I configure the client connection?' })
    await waitForPipeline(request, ticketId)
    const ticketPath = await ticketDetailPath(request, ticketId)

    // Resolve it.
    await page.goto(ticketPath)
    const statusForm = page.locator('form:has(select[name="status"])')
    await statusForm.locator('input[name="staffName"]').fill('Sarah')
    await statusForm.locator('select[name="status"]').selectOption('resolved')
    await statusForm.getByRole('button', { name: 'Update status' }).click()
    await expect(page.getByText(/open → resolved/)).toBeVisible()
    await waitForTicketField(request, ticketId, 'status', 'resolved')

    // Now it's a documentation gap (resolved how-to, not in KB).
    let a = await getAnalytics(request)
    expect(a.docGaps.some((g) => g.id === ticketId)).toBe(true)

    // Promote to KB → the gap closes.
    await page.goto(ticketPath)
    await page.getByRole('button', { name: 'Promote to KB' }).click()
    await expect(page.getByText('✓ In knowledge base')).toBeVisible()

    a = await getAnalytics(request)
    expect(a.docGaps.some((g) => g.id === ticketId)).toBe(false)
  })
})
