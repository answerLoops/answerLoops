import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ensureEnv } from '../../packages/agent-sdk/src/cli/env'

describe('Agent SDK — ensureEnv OAuth credentials validation', () => {
  let tmpDir: string
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sdk-env-test-'))
    originalEnv = { ...process.env }
    // Clean process.env of auth vars to test isolation
    delete process.env.DATABASE_URL
    delete process.env.AUTH_URL
    delete process.env.AUTH_GOOGLE_ID
    delete process.env.AUTH_GOOGLE_SECRET
    delete process.env.AUTH_GITHUB_ID
    delete process.env.AUTH_GITHUB_SECRET
  })

  afterEach(() => {
    process.env = originalEnv
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('accepts complete Google OAuth configuration', () => {
    const envContent = [
      'DATABASE_URL=postgresql://user:pass@localhost:5432/db',
      'AUTH_URL=http://localhost:3000',
      'AUTH_GOOGLE_ID=google-client-id',
      'AUTH_GOOGLE_SECRET=google-client-secret',
    ].join('\n')

    fs.writeFileSync(path.join(tmpDir, '.env'), envContent)
    expect(() => ensureEnv(tmpDir)).not.toThrow()

    // Generated secrets should be added to .env
    const result = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8')
    expect(result).toContain('AUTH_SECRET=')
    expect(result).toContain('ENCRYPTION_KEY=')
  })

  it('accepts complete GitHub OAuth configuration without Google', () => {
    const envContent = [
      'DATABASE_URL=postgresql://user:pass@localhost:5432/db',
      'AUTH_URL=http://localhost:3000',
      'AUTH_GITHUB_ID=github-client-id',
      'AUTH_GITHUB_SECRET=github-client-secret',
    ].join('\n')

    fs.writeFileSync(path.join(tmpDir, '.env'), envContent)
    expect(() => ensureEnv(tmpDir)).not.toThrow()
  })

  it('accepts both Google and GitHub OAuth configurations together', () => {
    const envContent = [
      'DATABASE_URL=postgresql://user:pass@localhost:5432/db',
      'AUTH_URL=http://localhost:3000',
      'AUTH_GOOGLE_ID=google-client-id',
      'AUTH_GOOGLE_SECRET=google-client-secret',
      'AUTH_GITHUB_ID=github-client-id',
      'AUTH_GITHUB_SECRET=github-client-secret',
    ].join('\n')

    fs.writeFileSync(path.join(tmpDir, '.env'), envContent)
    expect(() => ensureEnv(tmpDir)).not.toThrow()
  })

  it('rejects configuration when neither OAuth provider is configured', () => {
    const envContent = [
      'DATABASE_URL=postgresql://user:pass@localhost:5432/db',
      'AUTH_URL=http://localhost:3000',
    ].join('\n')

    fs.writeFileSync(path.join(tmpDir, '.env'), envContent)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit(1)')
    }) as unknown as (code?: string | number | null | undefined) => never)

    expect(() => ensureEnv(tmpDir)).toThrow('process.exit(1)')
    exitSpy.mockRestore()
  })

  it('rejects incomplete Google OAuth configuration when no GitHub pair exists', () => {
    const envContent = [
      'DATABASE_URL=postgresql://user:pass@localhost:5432/db',
      'AUTH_URL=http://localhost:3000',
      'AUTH_GOOGLE_ID=google-client-id',
      // missing AUTH_GOOGLE_SECRET
    ].join('\n')

    fs.writeFileSync(path.join(tmpDir, '.env'), envContent)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit(1)')
    }) as unknown as (code?: string | number | null | undefined) => never)

    expect(() => ensureEnv(tmpDir)).toThrow('process.exit(1)')
    exitSpy.mockRestore()
  })

  it('rejects incomplete GitHub OAuth configuration when no Google pair exists', () => {
    const envContent = [
      'DATABASE_URL=postgresql://user:pass@localhost:5432/db',
      'AUTH_URL=http://localhost:3000',
      'AUTH_GITHUB_SECRET=github-client-secret',
      // missing AUTH_GITHUB_ID
    ].join('\n')

    fs.writeFileSync(path.join(tmpDir, '.env'), envContent)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit(1)')
    }) as unknown as (code?: string | number | null | undefined) => never)

    expect(() => ensureEnv(tmpDir)).toThrow('process.exit(1)')
    exitSpy.mockRestore()
  })

  it('rejects configuration where both Google and GitHub have only incomplete pairs', () => {
    const envContent = [
      'DATABASE_URL=postgresql://user:pass@localhost:5432/db',
      'AUTH_URL=http://localhost:3000',
      'AUTH_GOOGLE_ID=google-client-id',
      'AUTH_GITHUB_SECRET=github-client-secret',
    ].join('\n')

    fs.writeFileSync(path.join(tmpDir, '.env'), envContent)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit(1)')
    }) as unknown as (code?: string | number | null | undefined) => never)

    expect(() => ensureEnv(tmpDir)).toThrow('process.exit(1)')
    exitSpy.mockRestore()
  })

  it('rejects configuration missing DATABASE_URL or AUTH_URL even if OAuth is present', () => {
    const envContent = [
      'AUTH_GITHUB_ID=github-client-id',
      'AUTH_GITHUB_SECRET=github-client-secret',
    ].join('\n')

    fs.writeFileSync(path.join(tmpDir, '.env'), envContent)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit(1)')
    }) as unknown as (code?: string | number | null | undefined) => never)

    expect(() => ensureEnv(tmpDir)).toThrow('process.exit(1)')
    exitSpy.mockRestore()
  })

  it('rejects configuration where OAuth credentials are whitespace only', () => {
    const envContent = [
      'DATABASE_URL=postgresql://user:pass@localhost:5432/db',
      'AUTH_URL=http://localhost:3000',
      'AUTH_GITHUB_ID=   ',
      'AUTH_GITHUB_SECRET=   ',
    ].join('\n')

    fs.writeFileSync(path.join(tmpDir, '.env'), envContent)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit(1)')
    }) as unknown as (code?: string | number | null | undefined) => never)

    expect(() => ensureEnv(tmpDir)).toThrow('process.exit(1)')
    exitSpy.mockRestore()
  })

  it('falls back to process.env when a key exists in .env but has an empty or whitespace value', () => {
    const envContent = [
      'DATABASE_URL=',
      'AUTH_URL=  ',
      'AUTH_GITHUB_ID=',
      'AUTH_GITHUB_SECRET=  ',
    ].join('\n')

    fs.writeFileSync(path.join(tmpDir, '.env'), envContent)
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db'
    process.env.AUTH_URL = 'http://localhost:3000'
    process.env.AUTH_GITHUB_ID = 'github-client-id'
    process.env.AUTH_GITHUB_SECRET = 'github-client-secret'

    expect(() => ensureEnv(tmpDir)).not.toThrow()
  })
})
