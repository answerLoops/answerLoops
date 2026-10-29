import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { CASE_TYPES, checkCaseConsistency, truthFor, type Dataset } from '@/lib/kb/support/eval'

/**
 * The evaluation dataset is hand-written and human-labeled. These tests check it
 * is well formed and that its labels agree with its own expectations under the
 * code that derives states, so a labeling slip is caught before any model runs.
 * They cannot check that a label is *right*: that is what review is for, and the
 * file says it has not been reviewed until a person sets `reviewed`.
 */

const dataset = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'source-support', 'dataset.json'), 'utf-8')
) as Dataset

describe('the source-support dataset', () => {
  it('covers every required case type, each with several examples', () => {
    for (const type of CASE_TYPES) {
      const n = dataset.cases.filter((c) => c.type === type).length
      expect(n, `${type} has ${n} cases`).toBeGreaterThanOrEqual(3)
    }
  })

  it('uses only known case types, with unique ids', () => {
    const ids = dataset.cases.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of dataset.cases) expect(CASE_TYPES).toContain(c.type)
  })

  it.each(dataset.cases.map((c) => [c.id, c] as const))('%s: every label resolves to a real claim and passage', (_id, c) => {
    expect(() => truthFor(c)).not.toThrow()
  })

  it.each(dataset.cases.map((c) => [c.id, c] as const))('%s: the human labels give the human-expected states', (_id, c) => {
    expect(checkCaseConsistency(c)).toEqual([])
  })

  it('every case explains its labels for the reviewer', () => {
    for (const c of dataset.cases) expect(c.note.trim().length, c.id).toBeGreaterThan(10)
  })

  it('contains no real customer text: no email addresses, links or phone numbers', () => {
    const text = JSON.stringify(dataset)
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
    expect(text).not.toMatch(/https?:\/\//)
    expect(text).not.toMatch(/\+?\d[\d\s().-]{8,}\d/)
  })

  it('says honestly that its labels have not been reviewed by a person yet', () => {
    // Flip `reviewed` and set `reviewedBy` only when a person has checked every label.
    expect(dataset.reviewed).toBe(false)
    expect(dataset.reviewedBy).toBeNull()
  })

  it('includes both kinds of instruction-in-text case, and cases with no articles at all', () => {
    expect(dataset.cases.some((c) => c.type === 'instruction_in_article')).toBe(true)
    expect(dataset.cases.some((c) => c.type === 'instruction_in_answer')).toBe(true)
    expect(dataset.cases.filter((c) => c.articles.length === 0).length).toBeGreaterThanOrEqual(3)
  })
})
