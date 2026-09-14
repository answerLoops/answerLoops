import { test, expect } from '@playwright/test'
import type { Page, APIRequestContext } from '@playwright/test'
import { ingest, waitForPipeline, waitForTicketField, waitFor } from './helpers'

interface KBArticle {
  id: number
  question: string
  answer: string
  source_ticket_id: number | null
  score?: number
}

/** Ingest a question, let the pipeline answer, resolve it, and promote to KB. */
async function promotedTicket(page: Page, request: APIRequestContext): Promise<number> {
  const ticketId = await ingest(request, { content: 'How do I configure the client connection?' })
  await waitForPipeline(request, ticketId)

  // Resolve via the status form.
  await page.goto(`/tickets/${ticketId}`)
  const statusForm = page.locator('form:has(select[name="status"])')
  await statusForm.locator('input[name="staffName"]').fill('Sarah')
  await statusForm.locator('select[name="status"]').selectOption('resolved')
  await statusForm.getByRole('button', { name: 'Update status' }).click()
  await expect(page.getByText(/open → resolved/)).toBeVisible()

  // Reload so the page renders the KB section (only shown for resolved tickets).
  await waitForTicketField(request, ticketId, 'status', 'resolved')
  await page.goto(`/tickets/${ticketId}`)
  await page.getByRole('button', { name: 'Promote to KB' }).click()

  return ticketId
}

test.describe('knowledge base', () => {
  test('promote a resolved ticket, then find it by list and search', async ({ request, page }) => {
    const ticketId = await promotedTicket(page, request)

    // The article shows up in the KB list, linked to its source ticket.
    const listed = (await waitFor(async () => {
      const all = (await request.get('/api/kb').then((r) => r.json())) as KBArticle[]
      return all.find((a) => a.source_ticket_id === ticketId) ?? false
    })) as KBArticle
    expect(listed.question).toContain('configure')

    // And semantic search surfaces it for a related query.
    const { results } = (await request
      .get(`/api/kb/search?q=${encodeURIComponent('how do I configure the client')}`)
      .then((r) => r.json())) as { results: KBArticle[]; degraded: boolean }
    expect(results.some((a) => a.source_ticket_id === ticketId)).toBe(true)
  })

  test('search returns nothing for a blank query', async ({ request }) => {
    const res = await request.get('/api/kb/search?q=')
    expect(await res.json()).toEqual([])
  })

  test('the KB page renders promoted articles', async ({ request, page }) => {
    await promotedTicket(page, request)

    await page.goto('/kb')
    await expect(page.getByRole('heading', { name: 'Knowledge Base' })).toBeVisible()
    await expect(page.getByText(/configure the client/i).first()).toBeVisible()
  })
})
