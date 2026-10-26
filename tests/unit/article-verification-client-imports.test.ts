import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// The verification form is a client component. lib/kb/verification.ts imports
// the content hash, which uses node:crypto, so importing that file from the
// form breaks the dashboard's browser bundle (the whole /kb page fails to
// build) while every unit test still passes. This pins the form to the
// browser-safe limits file.

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')

describe('article verification form imports', () => {
  const form = read('components/dashboard/article-verification.tsx')

  it('is a client component', () => {
    expect(form.trimStart().startsWith("'use client'")).toBe(true)
  })

  it('does not import the hashing modules', () => {
    expect(form).not.toMatch(/from '@\/lib\/kb\/verification'/)
    expect(form).not.toMatch(/from '@\/lib\/kb\/revision'/)
    expect(form).not.toMatch(/node:crypto|from 'crypto'/)
  })

  it('takes the note limit from the browser-safe file', () => {
    expect(form).toMatch(/from '@\/lib\/kb\/verification-limits'/)
  })

  it('keeps the browser-safe file free of Node imports', () => {
    expect(read('lib/kb/verification-limits.ts')).not.toMatch(/^import /m)
  })
})
