import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// With Automatic Deflections off the bot posts nothing to the channel (Google
// Chat alone gets a neutral receipt; see postNeedsHumanReview in
// lib/ai/agent.ts). The help text next to the toggle once promised "a brief
// acknowledgment", which sent owners looking for a message that never arrives.

const SETTINGS_DIR = path.join(process.cwd(), 'components/settings')

const channelFiles = fs
  .readdirSync(SETTINGS_DIR)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ name: f, text: fs.readFileSync(path.join(SETTINGS_DIR, f), 'utf-8') }))

describe('Automatic Deflections help text', () => {
  const withToggle = channelFiles.filter((f) => f.text.includes('When off, high-confidence'))

  it('covers every channel that has the toggle', () => {
    expect(withToggle.map((f) => f.name).sort()).toEqual(
      ['discord.tsx', 'discourse.tsx', 'email.tsx', 'github.tsx', 'googlechat.tsx', 'slack.tsx', 'telegram.tsx'],
    )
  })

  it.each(withToggle.map((f) => [f.name, f.text]))('%s does not promise an acknowledgment', (_name, text) => {
    expect(text).not.toMatch(/brief acknowledgment/i)
  })

  it.each(withToggle.map((f) => [f.name, f.text]))('%s says nothing is posted until approval', (_name, text) => {
    expect(text).toMatch(/until your team approves a draft/)
  })
})
