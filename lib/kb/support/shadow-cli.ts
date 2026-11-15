import {
  buildLabelTemplate,
  buildShadowFiles,
  buildShadowReport,
  combineColumns,
  drawStratifiedSample,
  formatShadowReport,
  summarizeCost,
  validateLabelsFile,
  ShadowLabelError,
  ShadowSampleError,
  SHADOW_JUDGE_LABELS,
  type BlindLabelingFile,
  type CostRow,
  type ShadowCandidate,
  type ShadowKey,
  type ShadowMethod,
  type ShadowPopulation,
} from './shadow'
import { SHADOW_TARGETS } from './targets'

/**
 * The commands behind `pnpm support:shadow`. Every side effect (files, the
 * database, pricing, output) comes in through `io`, so the commands can be
 * tested without a database and the output checked for excerpt text. Output
 * is counts, ids and paths only: excerpt text is written to the labeling file
 * and nowhere else, and never logged.
 */

export interface ShadowPoolData {
  excerptStorageEnabled: boolean
  candidates: ShadowCandidate[]
  population: ShadowPopulation
  usage: CostRow[]
}

export interface ShadowIO {
  readText(path: string): string
  writeText(path: string, text: string): void
  exists(path: string): boolean
  log(line: string): void
  error(line: string): void
  now(): Date
  method: ShadowMethod
  loadPool(orgId: number): Promise<ShadowPoolData>
  loadExcerpts(orgId: number, findingIds: number[]): Promise<Map<number, { claim: string; passage: string }>>
  price(usage: { judgeInputTokens: number; judgeOutputTokens: number; embeddingTokens: number }, judgeModel: string): number | null
}

export const SHADOW_USAGE = [
  'Usage: pnpm support:shadow <command>',
  '',
  '  sample   --org=<id> --size=<n> --out=<labeling.json> [--seed=<seed>] [--key=<key.json>] [--force]',
  '           Draws a blind labeling file and a separate key from one workspace. Run it only as',
  '           that workspace\'s owner or an approved maintainer; it needs excerpt storage on.',
  '  template --out=<labels.json> [--sample=<labeling.json>] [--force]',
  '           Writes an empty labels file with the schema and instructions.',
  '  report   --labels=<labels.json>[,<second-labels.json>] --key=<key.json> [--json]',
  '           Compares the labels with the judge and ends with a GO or NO-GO verdict.',
].join('\n')

export class ShadowCliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShadowCliError'
  }
}

export function parseFlags(args: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>()
  for (const a of args) {
    if (!a.startsWith('--')) throw new ShadowCliError(`Unexpected argument "${a}"`)
    const eq = a.indexOf('=')
    if (eq === -1) flags.set(a.slice(2), 'true')
    else flags.set(a.slice(2, eq), a.slice(eq + 1))
  }
  return flags
}

function required(flags: Map<string, string>, name: string): string {
  const v = flags.get(name)
  if (!v || v === 'true') throw new ShadowCliError(`--${name}=<value> is required`)
  return v
}

function positiveInt(flags: Map<string, string>, name: string): number {
  const raw = required(flags, name)
  const n = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < 1) throw new ShadowCliError(`--${name} must be a whole number of at least 1`)
  return n
}

function refuseOverwrite(io: ShadowIO, path: string, force: boolean) {
  if (!force && io.exists(path)) throw new ShadowCliError(`${path} already exists; pass --force to replace it`)
}

function readJson(io: ShadowIO, path: string): unknown {
  let text: string
  try {
    text = io.readText(path)
  } catch {
    throw new ShadowCliError(`Cannot read ${path}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new ShadowCliError(`${path} is not valid JSON`)
  }
}

export const defaultKeyPath = (out: string) => (out.endsWith('.json') ? `${out.slice(0, -'.json'.length)}.key.json` : `${out}.key.json`)

async function sample(flags: Map<string, string>, io: ShadowIO) {
  const orgId = positiveInt(flags, 'org')
  const size = positiveInt(flags, 'size')
  const out = required(flags, 'out')
  const keyPath = flags.get('key') ?? defaultKeyPath(out)
  const seed = flags.get('seed') ?? `org-${orgId}`
  const force = flags.get('force') === 'true'
  if (keyPath === out) throw new ShadowCliError('The key must be a different file from the labeling file')
  refuseOverwrite(io, out, force)
  refuseOverwrite(io, keyPath, force)

  const pool = await io.loadPool(orgId)
  if (!pool.excerptStorageEnabled) {
    throw new ShadowCliError(`Workspace ${orgId} has excerpt storage off, so there is nothing a person could label. Nothing was written.`)
  }
  if (pool.candidates.length < size) {
    throw new ShadowCliError(
      `Workspace ${orgId} has ${pool.candidates.length} findings with stored excerpts under this method version; ${size} were requested. Nothing was written.`
    )
  }

  const drawn = drawStratifiedSample(pool.candidates, size, seed)
  const excerpts = await io.loadExcerpts(orgId, drawn.selected.map((c) => c.findingId))
  const { blind, key } = buildShadowFiles({
    orgId,
    seed,
    createdAt: io.now().toISOString(),
    method: io.method,
    population: pool.population,
    cost: summarizeCost(pool.usage, io.price, SHADOW_TARGETS.costCeilingMicros),
    sample: drawn,
    excerpts,
  })

  io.writeText(out, `${JSON.stringify(blind, null, 2)}\n`)
  io.writeText(keyPath, `${JSON.stringify(key, null, 2)}\n`)
  io.log(`Wrote ${blind.items.length} items to ${out} (sample ${blind.sampleId}) and the key to ${keyPath}.`)
  io.log(
    `Strata by judge label (sampled/available): ${SHADOW_JUDGE_LABELS.map((l) => `${l} ${drawn.strata[l].sampled}/${drawn.strata[l].population}`).join(', ')}.`
  )
  if (size < SHADOW_TARGETS.minLabeledPairs) {
    io.log(`Note: a go decision needs at least ${SHADOW_TARGETS.minLabeledPairs} labeled pairs; this sample has ${size}.`)
  }
  io.log('Give the labeler the labeling file only. Keep the key apart until every label is written.')
}

function template(flags: Map<string, string>, io: ShadowIO) {
  const out = required(flags, 'out')
  refuseOverwrite(io, out, flags.get('force') === 'true')
  const samplePath = flags.get('sample')
  let blind: BlindLabelingFile | undefined
  if (samplePath) {
    const raw = readJson(io, samplePath) as Partial<BlindLabelingFile>
    if (raw?.format !== 'source-support-shadow-labeling' || !Array.isArray(raw.items) || typeof raw.sampleId !== 'string') {
      throw new ShadowCliError(`${samplePath} is not a labeling file`)
    }
    blind = raw as BlindLabelingFile
  }
  const file = buildLabelTemplate(blind)
  io.writeText(out, `${JSON.stringify(file, null, 2)}\n`)
  io.log(`Wrote a labels template to ${out}${blind ? ` with ${file.labels.length} items` : ''}.`)
}

function report(flags: Map<string, string>, io: ShadowIO) {
  const labelPaths = required(flags, 'labels').split(',').map((p) => p.trim()).filter(Boolean)
  const key = readJson(io, required(flags, 'key')) as ShadowKey
  if (key?.format !== 'source-support-shadow-key' || !Array.isArray(key.items)) throw new ShadowCliError('--key is not a shadow key file')
  const columns = combineColumns(labelPaths.map((p) => validateLabelsFile(readJson(io, p), key)))
  const result = buildShadowReport(key, columns)
  if (flags.get('json') === 'true') {
    io.log(JSON.stringify(result, null, 2))
    return result
  }
  io.log(formatShadowReport(result))
  return result
}

/** Runs one command. Returns the process exit code: 0 when it did its job, 1 on an error or refusal. */
export async function runShadowCli(argv: readonly string[], io: ShadowIO): Promise<number> {
  const [command, ...rest] = argv
  try {
    const flags = parseFlags(rest)
    if (command === 'sample') await sample(flags, io)
    else if (command === 'template') template(flags, io)
    else if (command === 'report') report(flags, io)
    else {
      io.error(SHADOW_USAGE)
      return 1
    }
    return 0
  } catch (err) {
    if (err instanceof ShadowCliError || err instanceof ShadowSampleError || err instanceof ShadowLabelError) {
      io.error(err.message)
      return 1
    }
    // Anything else could carry row data in its message; print only its kind.
    const code = err && typeof err === 'object' && 'code' in err ? ` ${String((err as { code: unknown }).code)}` : ''
    io.error(`The command failed (${err instanceof Error ? err.name : 'unknown error'}${code}).`)
    return 1
  }
}
