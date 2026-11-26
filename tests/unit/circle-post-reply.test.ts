import { describe, it, expect, vi, beforeEach } from 'vitest'

// The shared send dispatch (lib/channels/post-reply.ts) routes a Circle reply
// to postToCirclePost with the post id, and hands back the posted comment's id
// in the same `circle-comment-<id>` form the Circle webhook uses for incoming
// comments. Callers store that id on the ticket, which is how the webhook
// recognises the comment when Circle sends it back.

const { postToCirclePost, sendToChannel } = vi.hoisted(() => ({
  postToCirclePost: vi.fn(async (_postId: string, _content: string, _orgId: number): Promise<string | null> => '777'),
  sendToChannel: vi.fn(async () => 'discord-msg-id'),
}))

vi.mock('@/lib/circle/send', () => ({ postToCirclePost }))
vi.mock('@/lib/discord/send', () => ({ sendToChannel }))
vi.mock('@/lib/slack/send', () => ({ sendToSlackChannel: vi.fn() }))
vi.mock('@/lib/telegram/send', () => ({ sendToTelegramChat: vi.fn() }))
vi.mock('@/lib/email/reply', () => ({ sendEmailReply: vi.fn() }))
vi.mock('@/lib/google-chat/send', () => ({ sendToGoogleChatSpace: vi.fn() }))
vi.mock('@/lib/discourse/send', () => ({ postToDiscourseTopic: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

describe('postReply: circle', () => {
  it('posts to the Circle post and returns the comment id in the webhook’s message id form', async () => {
    const { postReply } = await import('@/lib/channels/post-reply')

    const result = await postReply('42', 'the answer', 3, 'circle', 1)

    expect(postToCirclePost).toHaveBeenCalledWith('42', 'the answer', 3)
    expect(result).toBe('circle-comment-777')
    expect(sendToChannel).not.toHaveBeenCalled()
  })

  it('returns null when Circle did not take the comment', async () => {
    postToCirclePost.mockResolvedValueOnce(null)
    const { postReply } = await import('@/lib/channels/post-reply')

    expect(await postReply('42', 'the answer', 3, 'circle', 1)).toBeNull()
  })

  it('the id matches the message id the webhook gives the same comment', async () => {
    const { postReply } = await import('@/lib/channels/post-reply')
    const { circleMessageId } = await import('@/lib/circle/client')

    expect(await postReply('42', 'the answer', 3, 'circle', 1)).toBe(circleMessageId('comment', '777'))
  })
})
