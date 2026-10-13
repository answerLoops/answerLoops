import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { MARKETED_CHANNELS } from '@/lib/marketing/channels'

const src = readFileSync(path.join(process.cwd(), 'app/login/page.tsx'), 'utf-8')
const icons = readFileSync(path.join(process.cwd(), 'components/marketing/integration-icon.tsx'), 'utf-8')

describe('the login page says where answerLoops supports a community', () => {
  it('uses the homepage channel list rather than a copy that can drift from it', () => {
    expect(src).toContain("import { MARKETED_CHANNELS } from '@/lib/marketing/channels'")
    expect(src).toContain('MARKETED_CHANNELS.map(')
  })

  it('labels the logos so they cannot be mistaken for sign-in methods', () => {
    expect(src).toContain('answerLoops supports your community on:')
  })

  it('has a logo for every channel in the list', () => {
    for (const { name } of MARKETED_CHANNELS) {
      expect(icons, `no icon for ${name}`).toContain(`name === '${name}'`)
    }
  })
})
