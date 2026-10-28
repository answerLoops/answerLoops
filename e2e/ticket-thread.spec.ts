import { randomUUID } from 'crypto'
import { test, expect } from '@playwright/test'
import { BOT_AUTH, ingest, waitForPipeline } from './helpers'

// A conversation that arrives as several messages shows up as one ticket with
// every message on its page, in order. Driven through the same ingest endpoint
// the bot uses, with the thread id a channel supplies for later messages.

async function reply(request: import('@playwright/test').APIRequestContext, opts: { messageId: string; threadId: string; author: string; content: string; channelId: string }) {
  const res = await request.post('/api/ingest', {
    headers: BOT_AUTH,
    data: {
      message_id: opts.messageId,
      thread_id: opts.threadId,
      content: opts.content,
      author_id: `id-${opts.author}`,
      author_name: opts.author,
      channel_id: opts.channelId,
    },
  })
  expect(res.ok()).toBe(true)
  return (await res.json()) as { ticket_id: number; appended?: boolean; duplicate?: boolean }
}

test.describe('ticket conversation thread', () => {
  test('the whole history is on one ticket: the customer, answerLoops, and each team member, in order', async ({ request, page }) => {
    const run = randomUUID().slice(0, 8)
    const channelId = `thread-chan-${run}`
    const rootId = `root-${run}`
    const ticketId = await ingest(request, { content: 'How do I configure the client? It never connects', messageId: rootId, channelId, authorName: 'alice' })
    await waitForPipeline(request, ticketId)

    const first = await reply(request, { messageId: `r1-${run}`, threadId: rootId, author: 'bob', content: 'Same problem here after the update', channelId })
    const second = await reply(request, { messageId: `r2-${run}`, threadId: rootId, author: 'carol', content: 'Restarting did not help me either', channelId })
    expect(first).toMatchObject({ ticket_id: ticketId, appended: true })
    expect(second).toMatchObject({ ticket_id: ticketId, appended: true })

    await page.goto(`/tickets/${ticketId}`)
    const thread = page.getByRole('region', { name: 'Conversation' })

    // Two team members answer from the dashboard, one after the other.
    for (const [name, text] of [['Sarah', 'Sarah here: restarting the agent usually fixes it'], ['Dev', 'Dev here: the fix ships in the next release']]) {
      const form = page.locator('form', { has: page.getByPlaceholder(/Type your response/) })
      await form.getByPlaceholder('e.g. Sarah').fill(name)
      await form.getByPlaceholder(/Type your response/).fill(text)
      await form.getByRole('button', { name: /^Send reply/ }).click()
      await expect(thread.getByText(text)).toBeVisible()
    }

    const items = thread.getByRole('listitem')
    await expect(thread.getByRole('heading', { name: /5 messages/ })).toBeVisible()
    await expect(items).toHaveCount(5)
    // answerLoops's own answer comes first (it was posted before anyone else replied).
    await expect(items.nth(0)).toHaveAttribute('data-role', 'ai')
    await expect(items.nth(0)).toContainText('answerLoops')
    await expect(items.nth(1)).toContainText('bob')
    await expect(items.nth(1)).toContainText('Same problem here after the update')
    await expect(items.nth(1)).toHaveAttribute('data-role', 'customer')
    await expect(items.nth(2)).toContainText('carol')
    await expect(items.nth(2)).toContainText('Restarting did not help me either')
    // Each team member appears under their own name, in the order they replied.
    await expect(items.nth(3)).toContainText('Sarah')
    await expect(items.nth(3)).toHaveAttribute('data-role', 'staff')
    await expect(items.nth(4)).toContainText('Dev')
    await expect(items.nth(4)).toHaveAttribute('data-role', 'staff')

    // The opening message stays above the conversation.
    const original = page.locator('div:has(> h2:text-is("Original Message"))')
    await expect(original).toContainText('How do I configure the client? It never connects')
  })

  test('a message in a different conversation does not appear on this ticket', async ({ request, page }) => {
    const run = randomUUID().slice(0, 8)
    const channelId = `thread-chan-${run}`
    const ticketId = await ingest(request, { content: 'First question about exporting data', messageId: `a-${run}`, channelId })
    await waitForPipeline(request, ticketId)
    const other = await ingest(request, { content: 'Second question about billing invoices', messageId: `b-${run}`, channelId })
    expect(other).not.toBe(ticketId)

    await page.goto(`/tickets/${ticketId}`)
    // Only this ticket's own conversation (answerLoops's answer to it) is shown.
    const thread = page.getByRole('region', { name: 'Conversation' })
    await expect(thread).not.toContainText('billing invoices')
    await expect(thread.getByRole('listitem')).toHaveCount(1)
    await expect(thread.getByRole('listitem').first()).toHaveAttribute('data-role', 'ai')
  })

  test('the thread is readable on a phone-width screen', async ({ request, page }) => {
    const run = randomUUID().slice(0, 8)
    const channelId = `thread-chan-${run}`
    const rootId = `root-${run}`
    const ticketId = await ingest(request, { content: 'Question that needs a long conversation', messageId: rootId, channelId })
    await waitForPipeline(request, ticketId)
    await reply(request, { messageId: `r1-${run}`, threadId: rootId, author: 'bob', content: `${'x'.repeat(300)}\n[Attachment: ${'a'.repeat(120)}.png] — https://files.example/${'a'.repeat(120)}.png`, channelId })

    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto(`/tickets/${ticketId}`)
    await expect(page.getByRole('region', { name: 'Conversation' })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    // Every message, including a long attachment name, stays inside the screen.
    const box = await page.getByRole('region', { name: 'Conversation' }).getByRole('listitem').first().boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(375)
    const link = page.getByRole('link', { name: /aaaa/ })
    const linkBox = await link.boundingBox()
    expect(linkBox!.x + linkBox!.width).toBeLessThanOrEqual(375)
  })
})
