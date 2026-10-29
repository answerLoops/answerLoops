/**
 * Runs the source-support assessment on the human-labeled dataset with the
 * live judge and embedding models, and prints how it compares with the labels:
 * precision and recall per label, the effect of the similarity floor, how often
 * output was rejected, cost, and every disagreement.
 *
 *   OPENAI_API_KEY=<your-key> pnpm support:eval
 *   pnpm support:eval --types=direct_support,paraphrase
 *   pnpm support:eval --json
 *
 * This is the only place a live model is used for the dataset. It reads no
 * workspace data and writes nothing. Uses the platform default models on the
 * key in the environment, the same ones an included-usage workspace gets.
 */
import fs from 'node:fs'
import path from 'node:path'
import { CASE_TYPES, evaluateDataset, formatEvaluation, type CaseType, type Dataset } from '@/lib/kb/support'
import { assessmentCostMicros, judgeModelFor, liveEmbed, liveJudge } from '@/lib/ai/support-judge'
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/models'

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Set OPENAI_API_KEY to run the evaluation against the live models.')
    process.exit(1)
  }
  const args = process.argv.slice(2)
  const typesArg = args.find((a) => a.startsWith('--types='))?.slice('--types='.length)
  const types = typesArg ? typesArg.split(',').filter((t): t is CaseType => (CASE_TYPES as readonly string[]).includes(t)) : undefined
  if (typesArg && types?.length === 0) {
    console.error(`Unknown --types=. Known: ${CASE_TYPES.join(', ')}`)
    process.exit(1)
  }

  const dataset = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'source-support', 'dataset.json'), 'utf-8')
  ) as Dataset

  const report = await evaluateDataset(dataset, { judge: liveJudge(), embed: liveEmbed() }, { types })
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  const { modelId } = await judgeModelFor()
  const t = report.tokensPerAnswer
  const cost = t
    ? assessmentCostMicros({ judgeInputTokens: t.judgeInput, judgeOutputTokens: t.judgeOutput, embeddingTokens: t.embedding }, modelId, DEFAULT_EMBEDDING_MODEL)
    : null
  console.log(formatEvaluation(report, { costMicrosPerAnswer: cost }))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
