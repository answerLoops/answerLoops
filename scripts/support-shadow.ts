/**
 * The source-support shadow run and its go/no-go gate (#446).
 *
 *   DATABASE_URL=<your-postgres-connection-string> pnpm support:shadow sample --org=<id> --size=<n> --out=<labeling.json> [--seed=<seed>] [--key=<key.json>]
 *   pnpm support:shadow template --out=<labels.json> [--sample=<labeling.json>]
 *   pnpm support:shadow report --labels=<labels.json>[,<second-labels.json>] --key=<key.json> [--json]
 *
 * `sample` reads one workspace's completed assessments under the current
 * method version (only the workspace named by --org) and writes a blind
 * labeling file, holding item ids and excerpts and nothing about the judge,
 * plus a separate key that maps each item to the judge's label. It refuses
 * when the workspace has excerpt storage off or has fewer stored excerpts than
 * requested. Run it only as that workspace's owner or an approved maintainer:
 * no one else may read or label real customer excerpts. Give the labeler the
 * labeling file only, and keep the key apart until every label is written.
 *
 * `report` compares the labels with the key against the targets in
 * lib/kb/support/targets.ts and ends with GO or NO-GO. It reads no database.
 *
 * Excerpt text is never printed. Both output files are written readable by
 * the current user only.
 */
import fs from 'node:fs'
import { runShadowCli } from '@/lib/kb/support/shadow-cli'
import { SUPPORT_METHOD } from '@/lib/kb/support/method'
import { getShadowExcerpts, getShadowPool } from '@/lib/db/queries/kb-support'
import { assessmentCostMicros } from '@/lib/ai/support-judge'
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/models'

runShadowCli(process.argv.slice(2), {
  readText: (p) => fs.readFileSync(p, 'utf-8'),
  writeText: (p, text) => fs.writeFileSync(p, text, { encoding: 'utf-8', mode: 0o600 }),
  exists: (p) => fs.existsSync(p),
  log: (line) => console.log(line),
  error: (line) => console.error(line),
  now: () => new Date(),
  method: { ...SUPPORT_METHOD },
  loadPool: (orgId) => getShadowPool(orgId),
  loadExcerpts: (orgId, ids) => getShadowExcerpts(orgId, ids),
  // The embedding model is not stored with an assessment; included usage embeds with the platform default.
  price: (usage, judgeModel) => assessmentCostMicros(usage, judgeModel, DEFAULT_EMBEDDING_MODEL),
})
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`support:shadow failed (${err instanceof Error ? err.name : 'unknown error'})`)
    process.exit(1)
  })
