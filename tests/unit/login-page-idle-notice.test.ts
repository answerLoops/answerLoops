import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const login = readFileSync(path.join(process.cwd(), 'app/login/page.tsx'), 'utf-8')
const layout = readFileSync(path.join(process.cwd(), 'app/(dashboard)/layout.tsx'), 'utf-8')

describe('idle sign-out wiring', () => {
  it('the dashboard mounts the idle timer with the instance\'s idle hours', () => {
    expect(layout).toContain('<IdleSignOut idleHours={sessionIdleHours()} />')
  })

  it('the login page explains an idle sign-out, unless a sign-in error takes its place', () => {
    expect(login).toContain("const idleSignOut = !errorMessage && signedOut === 'idle'")
    expect(login).toContain('You were signed out after a period of inactivity.')
  })
})
