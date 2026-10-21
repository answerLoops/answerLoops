import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Issue #184: the answer pipeline classified every ticket into a category
// (bug/feature_request/documentation/how_to/general_question) but never read
// it when deciding how to answer, so bug reports and feature requests got a
// KB-grounded draft generated unconditionally — either wasting a generation
// on a low-confidence draft or, worse, producing a confident-sounding answer
// that explains away a real bug. runAIAgent now branches on category before
// doing any KB-grounded generation, and never runs the confidence grader for
// bug/feature_request tickets.
//
// Source-file structural assertions — same convention as kb-only-agent.test.ts,
// since runAIAgent calls live LLM functions that aren't mocked in this suite.

const ROOT = process.cwd()

function read(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('runAIAgent branches on ticket category before generating a KB-grounded draft', () => {
  it('accepts category and duplicates parameters', () => {
    const src = read('lib/ai/agent.ts')
    expect(src).toMatch(/category:\s*TicketCategory/)
    expect(src).toMatch(/duplicates:\s*Match\[\]/)
  })

  it('checks for bug/feature_request before calling supportAgent.generate', () => {
    const src = read('lib/ai/agent.ts')
    const branchIdx = src.indexOf("category === 'bug' || category === 'feature_request'")
    const generateIdx = src.indexOf('supportAgent.generate(')
    expect(branchIdx).toBeGreaterThan(-1)
    expect(generateIdx).toBeGreaterThan(-1)
    expect(branchIdx).toBeLessThan(generateIdx)
  })

  it('the bug/feature_request branch returns before ever reaching supportAgent.generate', () => {
    const src = read('lib/ai/agent.ts')
    const branchStart = src.indexOf("category === 'bug' || category === 'feature_request'")
    const generateIdx = src.indexOf('supportAgent.generate(')
    const branchBody = src.slice(branchStart, generateIdx)
    // The branch must close (return) before the shared KB-grounded flow below
    // it — return statements for the duplicate-match and KB-workaround
    // sub-cases, plus the trailing `return` that closes the whole `if` after
    // the human-routing fallback (which falls through to the end of the try).
    const returns = branchBody.match(/\breturn\b/g) ?? []
    expect(returns.length).toBeGreaterThanOrEqual(3)
  })

  it('the bug/feature_request branch never calls assessAnswer or shouldAutoDeflect', () => {
    const src = read('lib/ai/agent.ts')
    const branchStart = src.indexOf("category === 'bug' || category === 'feature_request'")
    const generateIdx = src.indexOf('supportAgent.generate(')
    const branchBody = src.slice(branchStart, generateIdx)
    expect(branchBody).not.toContain('assessAnswer(')
    expect(branchBody).not.toContain('shouldAutoDeflect(')
  })

  it('references a duplicate ticket by its own org-local number when a duplicate match exists', () => {
    const src = read('lib/ai/agent.ts')
    expect(src).toContain('duplicates.length > 0')
    // The related ticket's number is looked up separately (getTicketById)
    // rather than reusing top.related_id directly — that's the global DB
    // id, not the number a customer should ever see. See
    // tests/unit/org-ticket-numbers.test.ts for the dedicated coverage.
    expect(src).toMatch(/tracking as ticket #\$\{relatedNumber\}/)
  })

  it('frames a KB match as a workaround, not a fix', () => {
    const src = read('lib/ai/agent.ts')
    expect(src).toContain('priorAnswers.length > 0')
    expect(src.toLowerCase()).toContain('as a workaround')
    expect(src).toContain("isn't a resolution")
  })

  it('routes to a human via the existing needs_human status update when nothing matches', () => {
    const src = read('lib/ai/agent.ts')
    const branchStart = src.indexOf("category === 'bug' || category === 'feature_request'")
    const generateIdx = src.indexOf('supportAgent.generate(')
    const branchBody = src.slice(branchStart, generateIdx)
    expect(branchBody).toContain('postNeedsHumanReview(')
  })

  it('the how_to/documentation/general_question flow still calls the confidence grader unconditionally', () => {
    const src = read('lib/ai/agent.ts')
    const generateIdx = src.indexOf('supportAgent.generate(')
    const rest = src.slice(generateIdx)
    expect(rest).toContain('assessAnswer(question, text, orgId)')
    expect(rest).toContain('shouldAutoDeflect(assessment, threshold)')
  })

  it('postNeedsHumanReview is shared between the low-confidence path and the bug/feature_request path', () => {
    const src = read('lib/ai/agent.ts')
    const occurrences = src.match(/postNeedsHumanReview\(/g) ?? []
    // One function definition + two call sites (bug/feature_request fallback,
    // and the existing low-confidence KB-graded branch).
    expect(occurrences.length).toBe(3)
  })
})

describe('runBackgroundEnrichment threads category and duplicates into runAIAgent', () => {
  it('passes the ticket category and the duplicates list at the runAIAgent call site', () => {
    const src = read('lib/ingest/pipeline.ts')
    const callIdx = src.indexOf('runAIAgent(ticketId')
    expect(callIdx).toBeGreaterThan(-1)
    const callLine = src.slice(callIdx, src.indexOf(')', src.indexOf(')', callIdx) + 1) + 1)
    expect(callLine).toContain('category')
    expect(callLine).toContain('duplicates')
  })

  it('declares duplicates outside the inner try block so it is in scope at the runAIAgent call site', () => {
    const src = read('lib/ingest/pipeline.ts')
    const declIdx = src.indexOf('let duplicates')
    const callIdx = src.indexOf('runAIAgent(ticketId')
    expect(declIdx).toBeGreaterThan(-1)
    expect(declIdx).toBeLessThan(callIdx)
  })
})

describe('draft-skip reasons are recorded where drafting is skipped', () => {
  it("the bug/feature_request human-routing call records 'bug_or_feature'", () => {
    const src = read('lib/ai/agent.ts')
    const branchStart = src.indexOf("category === 'bug' || category === 'feature_request'")
    const generateIdx = src.indexOf('supportAgent.generate(')
    expect(src.slice(branchStart, generateIdx)).toContain("'bug_or_feature'")
  })

  it('postNeedsHumanReview forwards the reason to the status write', () => {
    const src = read('lib/ai/agent.ts')
    expect(src).toContain("updateTicketAIDraftStatus(ticketId, 'needs_human', undefined, skipReason)")
  })
})
