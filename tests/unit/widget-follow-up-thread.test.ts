import { describe, expect, it } from 'vitest'
import type { Message } from '@ag-ui/client'
import { followUpCallIds, latestFollowUpCallId } from '@/lib/widget/follow-up-thread'

/**
 * Which suggestions on screen are live: only the newest reply's, once their
 * result has arrived, before the visitor has answered, and never when the same
 * reply already carries another card.
 */

const call = (id: string, name: string) => ({ id, type: 'function' as const, function: { name, arguments: '{}' } })
const assistant = (id: string, calls: ReturnType<typeof call>[] = [], content = ''): Message =>
  ({ id, role: 'assistant', content, ...(calls.length ? { toolCalls: calls } : {}) }) as Message
const user = (id: string, content = 'hi'): Message => ({ id, role: 'user', content }) as Message
const result = (callId: string): Message => ({ id: `${callId}-r`, role: 'tool', toolCallId: callId, content: '{"ok":true}' }) as Message

describe('latestFollowUpCallId', () => {
  it('is the suggestions under the newest reply once their result is in', () => {
    const thread = [user('u1'), assistant('a1', [call('t1', 'show_follow_ups')], 'Answer'), result('t1')]
    expect(latestFollowUpCallId(thread)).toBe('t1')
  })

  it('is nothing while the result has not arrived yet', () => {
    expect(latestFollowUpCallId([user('u1'), assistant('a1', [call('t1', 'show_follow_ups')])])).toBeNull()
  })

  it('is nothing once the visitor has replied after them', () => {
    const thread = [user('u1'), assistant('a1', [call('t1', 'show_follow_ups')]), result('t1'), user('u2', 'What does it cost?')]
    expect(latestFollowUpCallId(thread)).toBeNull()
  })

  it('is only the newest reply: an older reply\'s suggestions are never live', () => {
    const thread = [
      user('u1'),
      assistant('a1', [call('t1', 'show_follow_ups')]),
      result('t1'),
      user('u2'),
      assistant('a2', [], 'A later answer with no suggestions'),
    ]
    expect(latestFollowUpCallId(thread)).toBeNull()
  })

  it('picks the newest of two replies that both offered suggestions', () => {
    const thread = [
      user('u1'),
      assistant('a1', [call('t1', 'show_follow_ups')]),
      result('t1'),
      assistant('a2', [call('t2', 'show_follow_ups')]),
      result('t2'),
    ]
    expect(latestFollowUpCallId(thread)).toBe('t2')
  })

  it('is nothing when the same reply carries another card', () => {
    for (const other of ['show_steps', 'show_link_card', 'show_contact_options', 'show_callout', 'show_choices']) {
      const thread = [user('u1'), assistant('a1', [call('t0', other), call('t1', 'show_follow_ups')]), result('t0'), result('t1')]
      expect(latestFollowUpCallId(thread), other).toBeNull()
    }
  })

  it('is nothing for a thread with no suggestions, or an empty one', () => {
    expect(latestFollowUpCallId([])).toBeNull()
    expect(latestFollowUpCallId([user('u1'), assistant('a1', [call('t1', 'show_steps')]), result('t1')])).toBeNull()
  })
})

describe('followUpCallIds', () => {
  it('lists every suggestions call in a thread, for telling a restored thread from a live one', () => {
    const thread = [
      user('u1'),
      assistant('a1', [call('t1', 'show_follow_ups')]),
      result('t1'),
      assistant('a2', [call('t2', 'show_steps'), call('t3', 'show_follow_ups')]),
    ]
    expect([...followUpCallIds(thread)].sort()).toEqual(['t1', 't3'])
  })

  it('is empty for a thread without any', () => {
    expect(followUpCallIds([user('u1'), assistant('a1', [], 'text')]).size).toBe(0)
  })
})
