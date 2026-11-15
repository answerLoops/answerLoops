import { describe, expect, it } from 'vitest'
import { defaultKeyPath, parseFlags, runShadowCli, type ShadowIO, type ShadowPoolData } from '@/lib/kb/support/shadow-cli'
import { SHADOW_JUDGE_LABELS, type ShadowCandidate, type ShadowJudgeLabel } from '@/lib/kb/support/shadow'
import { SUPPORT_METHOD } from '@/lib/kb/support/method'

// The `pnpm support:shadow` commands with every side effect faked: an
// in-memory filesystem, a pool instead of the database, and captured output.
// The main thing checked here is that excerpt text reaches the labeling file
// and nowhere else, and that the refusals write nothing.

const SECRET = 'PLANTED-EXCERPT-TEXT'

function pool(counts: Partial<Record<ShadowJudgeLabel, number>>, excerptStorageEnabled = true): ShadowPoolData {
  const candidates: ShadowCandidate[] = []
  let id = 1
  for (const label of SHADOW_JUDGE_LABELS) {
    for (let i = 0; i < (counts[label] ?? 0); i++, id++) {
      candidates.push({
        findingId: id,
        articleFindingId: id,
        assessmentId: id,
        answerId: `answer-${id}`,
        surface: 'widget',
        judgeLabel: label,
        articleSummary: label === 'supports' ? 'supporting' : 'inconclusive',
        answerSummary: label === 'supports' ? 'supporting' : 'inconclusive',
        sharedWithCount: 0,
        articleFindingsInAnswer: 1,
        answerHasContradiction: false,
      })
    }
  }
  return {
    excerptStorageEnabled,
    candidates,
    population: {
      assessments: { completed: candidates.length, failed: 1, skipped: 1 },
      answers: { supporting: 1, no_support: 0, inconclusive: 1, not_assessed: 2 },
      articles: { supporting: 1, no_support: 0, inconclusive: 1 },
      claimFindings: { supports: counts.supports ?? 0, partial: counts.partial ?? 0, contradicts: 0, inconclusive: counts.inconclusive ?? 0 },
    },
    usage: [{ judgeModel: 'priced-model', judgeInputTokens: 1000, judgeOutputTokens: 100, embeddingTokens: 50, count: candidates.length }],
  }
}

function fakeIO(data: ShadowPoolData, opts: { dropExcerpt?: number } = {}) {
  const files = new Map<string, string>()
  const out: string[] = []
  const err: string[] = []
  const loadedOrgs: number[] = []
  const io: ShadowIO = {
    readText: (p) => {
      const t = files.get(p)
      if (t === undefined) throw new Error('missing')
      return t
    },
    writeText: (p, t) => void files.set(p, t),
    exists: (p) => files.has(p),
    log: (l) => void out.push(l),
    error: (l) => void err.push(l),
    now: () => new Date('2026-11-09T12:00:00Z'),
    method: { ...SUPPORT_METHOD },
    loadPool: async (orgId) => {
      loadedOrgs.push(orgId)
      return data
    },
    loadExcerpts: async (orgId, ids) => {
      loadedOrgs.push(orgId)
      return new Map(
        ids.filter((id) => id !== opts.dropExcerpt).map((id) => [id, { claim: `${SECRET} claim ${id}`, passage: `${SECRET} passage ${id}` }])
      )
    },
    price: (u) => u.judgeInputTokens,
  }
  return { io, files, out, err, loadedOrgs, printed: () => [...out, ...err].join('\n') }
}

describe('support:shadow sample', () => {
  it('writes a blind labeling file and a separate key, reads only the named workspace, and never prints excerpt text', async () => {
    const f = fakeIO(pool({ supports: 30, partial: 10, inconclusive: 10 }))
    expect(await runShadowCli(['sample', '--org=7', '--size=20', '--seed=abc', '--out=/w/labeling.json'], f.io)).toBe(0)
    expect([...f.files.keys()].sort()).toEqual(['/w/labeling.json', '/w/labeling.key.json'])
    expect(f.loadedOrgs).toEqual([7, 7])

    const blind = JSON.parse(f.files.get('/w/labeling.json')!)
    const key = JSON.parse(f.files.get('/w/labeling.key.json')!)
    expect(blind.items).toHaveLength(20)
    expect(f.files.get('/w/labeling.json')).toContain(SECRET)
    expect(f.files.get('/w/labeling.key.json')).not.toContain(SECRET)
    expect(key.sampleId).toBe(blind.sampleId)
    expect(key.cost).toMatchObject({ priced: 50, overCeiling: 0, maxMicros: 1000 })

    expect(f.printed()).not.toContain(SECRET)
    expect(f.printed()).toMatch(/Wrote 20 items/)
    expect(f.printed()).toMatch(/a go decision needs at least 200 labeled pairs/)
  })

  it('is deterministic for the same seed', async () => {
    const a = fakeIO(pool({ supports: 30, partial: 10 }))
    const b = fakeIO(pool({ supports: 30, partial: 10 }))
    await runShadowCli(['sample', '--org=7', '--size=12', '--seed=s', '--out=/a.json'], a.io)
    await runShadowCli(['sample', '--org=7', '--size=12', '--seed=s', '--out=/a.json'], b.io)
    expect(a.files.get('/a.key.json')!.replace(/"createdAt": "[^"]+"/, '')).toBe(b.files.get('/a.key.json')!.replace(/"createdAt": "[^"]+"/, ''))
  })

  it('refuses when the workspace has excerpt storage off, and writes nothing', async () => {
    const f = fakeIO(pool({ supports: 300 }, false))
    expect(await runShadowCli(['sample', '--org=7', '--size=10', '--out=/x.json'], f.io)).toBe(1)
    expect(f.files.size).toBe(0)
    expect(f.err.join()).toMatch(/excerpt storage off/)
  })

  it('refuses when fewer excerpts exist than requested, and says how many', async () => {
    const f = fakeIO(pool({ supports: 5, partial: 3 }))
    expect(await runShadowCli(['sample', '--org=7', '--size=200', '--out=/x.json'], f.io)).toBe(1)
    expect(f.files.size).toBe(0)
    expect(f.err.join()).toMatch(/has 8 findings with stored excerpts under this method version; 200 were requested/)
  })

  it('refuses when a chosen excerpt disappeared before it was read, without printing any text', async () => {
    const f = fakeIO(pool({ supports: 10 }), { dropExcerpt: 3 })
    expect(await runShadowCli(['sample', '--org=7', '--size=10', '--out=/x.json'], f.io)).toBe(1)
    expect(f.files.size).toBe(0)
    expect(f.printed()).not.toContain(SECRET)
  })

  it('refuses to overwrite a file, a key in the same place as the labeling file, and bad numbers', async () => {
    const f = fakeIO(pool({ supports: 10 }))
    f.files.set('/x.json', 'old')
    expect(await runShadowCli(['sample', '--org=7', '--size=5', '--out=/x.json'], f.io)).toBe(1)
    expect(f.files.get('/x.json')).toBe('old')
    expect(await runShadowCli(['sample', '--org=7', '--size=5', '--out=/y.json', '--key=/y.json'], f.io)).toBe(1)
    expect(await runShadowCli(['sample', '--org=abc', '--size=5', '--out=/z.json'], f.io)).toBe(1)
    expect(await runShadowCli(['sample', '--org=7', '--size=0', '--out=/z.json'], f.io)).toBe(1)
    expect(await runShadowCli(['sample', '--org=7', '--size=5'], f.io)).toBe(1)
    expect(f.files.has('/z.json')).toBe(false)
  })

  it('prints only the error kind for an unexpected failure', async () => {
    const f = fakeIO(pool({ supports: 10 }))
    f.io.loadPool = async () => {
      throw new Error(`row text ${SECRET}`)
    }
    expect(await runShadowCli(['sample', '--org=7', '--size=5', '--out=/x.json'], f.io)).toBe(1)
    expect(f.printed()).not.toContain(SECRET)
    expect(f.err.join()).toMatch(/The command failed \(Error\)/)
  })
})

describe('support:shadow template and report', () => {
  it('runs the whole loop: sample, template, label, report', async () => {
    const f = fakeIO(pool({ supports: 8, partial: 2 }))
    await runShadowCli(['sample', '--org=7', '--size=10', '--seed=s', '--out=/l.json'], f.io)
    expect(await runShadowCli(['template', '--sample=/l.json', '--out=/labels.json'], f.io)).toBe(0)
    const template = JSON.parse(f.files.get('/labels.json')!)
    expect(f.files.get('/labels.json')).not.toContain(SECRET)
    expect(template.labels).toHaveLength(10)

    // Fill in as a reviewer would, from the labeling file alone.
    template.reviewer = { name: 'Owner', role: 'workspace_owner', labeledBlind: true }
    for (const l of template.labels) l.label = 'supports'
    f.files.set('/labels.json', JSON.stringify(template))

    f.out.length = 0
    expect(await runShadowCli(['report', '--labels=/labels.json', '--key=/l.key.json'], f.io)).toBe(0)
    const text = f.out.join('\n')
    expect(text).toMatch(/10 labeled/)
    expect(text).toMatch(/VERDICT: NO-GO/)
    expect(text).toMatch(/need 190 more labels/)
    expect(text).not.toContain(SECRET)

    f.out.length = 0
    expect(await runShadowCli(['report', '--labels=/labels.json', '--key=/l.key.json', '--json'], f.io)).toBe(0)
    const json = JSON.parse(f.out.join('\n'))
    expect(json.verdict.decision).toBe('NO-GO')
    expect(json.supporting.findings).toEqual({ predicted: 8, confirmed: 8, precision: 1 })
  })

  it('refuses a labels file that does not validate, and an untouched template', async () => {
    const f = fakeIO(pool({ supports: 4 }))
    await runShadowCli(['sample', '--org=7', '--size=4', '--out=/l.json'], f.io)
    await runShadowCli(['template', '--sample=/l.json', '--out=/labels.json'], f.io)
    expect(await runShadowCli(['report', '--labels=/labels.json', '--key=/l.key.json'], f.io)).toBe(1)
    expect(f.err.join('\n')).toMatch(/role must be one of workspace_owner, approved_maintainer/)
    expect(await runShadowCli(['report', '--labels=/missing.json', '--key=/l.key.json'], f.io)).toBe(1)
    expect(await runShadowCli(['report', '--labels=/labels.json', '--key=/l.json'], f.io)).toBe(1)
  })

  it('writes a bare template without a sample, and refuses to overwrite it', async () => {
    const f = fakeIO(pool({}))
    expect(await runShadowCli(['template', '--out=/t.json'], f.io)).toBe(0)
    expect(JSON.parse(f.files.get('/t.json')!).labels).toEqual([])
    expect(await runShadowCli(['template', '--out=/t.json'], f.io)).toBe(1)
    expect(await runShadowCli(['template', '--out=/t.json', '--force'], f.io)).toBe(0)
  })

  it('prints the usage for an unknown command', async () => {
    const f = fakeIO(pool({}))
    expect(await runShadowCli(['nope'], f.io)).toBe(1)
    expect(f.err.join()).toMatch(/Usage: pnpm support:shadow/)
  })
})

describe('flags', () => {
  it('parses --name=value and bare --flag, and refuses stray words', () => {
    expect([...parseFlags(['--org=3', '--json'])]).toEqual([
      ['org', '3'],
      ['json', 'true'],
    ])
    expect(() => parseFlags(['org=3'])).toThrow(/Unexpected argument/)
    expect(defaultKeyPath('/a/b.json')).toBe('/a/b.key.json')
    expect(defaultKeyPath('/a/b')).toBe('/a/b.key.json')
  })
})
