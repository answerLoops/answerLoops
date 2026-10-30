/**
 * Folds GitHub comment tickets created before threading into the ticket of the
 * issue they were written on. Each comment becomes a message on that ticket and
 * the stand-alone ticket is removed. A comment whose issue has no ticket, or
 * that someone already replied to, is left alone.
 *
 *   DATABASE_URL=<your-postgres-connection-string> pnpm github:backfill-threads --org=3 --dry-run
 *   DATABASE_URL=<your-postgres-connection-string> pnpm github:backfill-threads --org=3
 *
 * Needs the GitHub App credentials in the environment, since each comment is
 * looked up through the organization's own installation. Always pass --org: the
 * run only ever touches that one organization. Safe to run again.
 */
import { backfillGithubCommentThreads, githubParentResolver } from '@/lib/github/thread-backfill'

async function main() {
  const args = process.argv.slice(2)
  const orgArg = args.find((a) => a.startsWith('--org='))?.slice('--org='.length)
  const orgId = Number(orgArg)
  if (!orgArg || !Number.isInteger(orgId) || orgId < 1) {
    console.error('Pass the organization to backfill: --org=<id>')
    process.exit(1)
  }
  const dryRun = args.includes('--dry-run')

  const summary = await backfillGithubCommentThreads(orgId, githubParentResolver(orgId), { dryRun })
  console.log(`${dryRun ? 'Dry run' : 'Done'} for organization ${orgId}:`)
  console.log(`  attached to their issue's ticket: ${dryRun ? summary.wouldAttach : summary.attached}`)
  console.log(`  issue has no ticket here:         ${summary.noParentTicket}`)
  console.log(`  could not look up the comment:    ${summary.unresolved}`)
  console.log(`  already replied to, kept as is:   ${summary.hasReplies}`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
