import { describe, it, expect } from 'vitest'
import {
  MARKETED_CHANNELS,
  MARKETED_CHANNEL_NAMES,
  channelListSentence,
} from '@/lib/marketing/channels'

describe('canonical marketed channel list', () => {
  it('is the agreed set, in the agreed order', () => {
    expect(MARKETED_CHANNEL_NAMES).toEqual([
      'Discord',
      'Slack',
      'Discourse',
      'Circle',
      'GitHub',
      'Telegram',
      'Email',
      'Google Chat',
      'Website widget',
    ])
  })

  it('gives every rail channel a hex color', () => {
    for (const c of MARKETED_CHANNELS) {
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('renders an Oxford-comma sentence with the overridable last label', () => {
    expect(channelListSentence()).toBe(
      'Discord, Slack, Discourse, Circle, GitHub, Telegram, Email, Google Chat, and a website widget',
    )
    expect(channelListSentence('web chat')).toMatch(/, and web chat$/)
  })
})
