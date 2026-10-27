import { test, expect } from '@playwright/test'
import { ingest, waitForPipeline, getTicket } from './helpers'

// Proves the harness end-to-end: bot ingest -> triage -> embed -> agent ->
// assess, all under mock mode, with the result observable via the API and the UI.
test.describe('smoke: ingest pipeline', () => {
  test('a confident question is triaged, answered, and auto-deflected', async ({ request, page }) => {
    const ticketId = await ingest(request, {
      content: 'How do I configure the client connection?',
    })
    expect(ticketId).toBeGreaterThan(0)

    // Triage ran synchronously during ingest.
    const ticket = (await getTicket(request, ticketId))!
    expect(ticket.category).toBe('how_to')

    // Background agent + assess finish shortly after.
    await waitForPipeline(request, ticketId)

    // The auto-answer shows on the ticket detail page.
    await page.goto(`/tickets/${ticketId}`)
    await expect(page.getByText('AI Confidence')).toBeVisible()
    await expect(page.getByText(/auto-answered/i).first()).toBeVisible()
  })

  test('an unsure answer is routed to a human', async ({ request, page }) => {
    const ticketId = await ingest(request, {
      content: 'Something weird is happening with my setup [[needhuman]]',
    })
    await waitForPipeline(request, ticketId)

    await page.goto(`/tickets/${ticketId}`)
    await expect(page.getByText(/needs human review/i)).toBeVisible()
  })
})
