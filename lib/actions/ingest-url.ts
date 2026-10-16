'use server'

import { z } from 'zod'
import { requireOrgAccess } from '@/lib/auth/org'
import { ingestValidatedUrl, ingestValidatedSite, IngestLimitError } from '@/lib/ingest/url'
import { assertImportableUrl, UrlValidationError } from '@/lib/ingest/url-validation'
import { rateLimitShared } from '@/lib/ratelimit'
import { NoAIProviderConfiguredError } from '@/lib/ai/models'
import { aiUnavailableMessage } from '@/lib/ai/errors'
import { logger } from '@/lib/logger'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'

const Schema = z.object({
  url: z.string().url('Must be a valid URL').max(2048, 'URL is too long'),
  mode: z.enum(['page', 'site']),
})

// Each workspace can run 10 imports per 10 minutes. The key is distinct from
// the shared ingest request budget in lib/ingest/limits so the two counters
// never share a bucket.
const IMPORT_MAX = 10
const IMPORT_WINDOW_MS = 10 * 60_000

export interface IngestUrlResult {
  error?: string
  created?: number
  pages?: number
  pagesFound?: number
  skipped?: number
  /**
   * Pages discovered and not yet ingested that this run did not have budget
   * for. Non-zero means running the import again will make further progress —
   * without it the UI cannot distinguish "finished" from "hit the per-run cap".
   */
  remaining?: number
  incomplete?: boolean
}

export async function ingestUrlAction(
  _prevState: unknown,
  formData: FormData,
): Promise<IngestUrlResult> {
  const access = await requireOrgAccess(['owner', 'admin'])
  if (!access.ok) return { error: access.error }
  const orgId = access.orgId

  if (!MOCK_EXTERNALS && !process.env.FIRECRAWL_API_KEY) {
    return { error: 'URL import is not configured for this workspace. Contact your administrator.' }
  }

  const limit = await rateLimitShared(`kb-url-import:${orgId}`, IMPORT_MAX, IMPORT_WINDOW_MS)
  if (!limit.ok) {
    const mins = Math.ceil(limit.retryAfterMs / 60_000)
    return { error: `Import rate limit reached. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` }
  }

  const parsed = Schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { url, mode } = parsed.data

  try {
    // Check the address once, with a clear message, before any work starts.
    // The importers take the checked address so it is not looked up again.
    const checked = await assertImportableUrl(url, { resolveDns: !MOCK_EXTERNALS })
    if (mode === 'site') {
      const result = await ingestValidatedSite(checked, orgId, undefined, url.trim())
      return {
        created: result.created,
        pages: result.pages,
        pagesFound: result.pagesFound,
        skipped: result.skipped,
        remaining: result.remaining,
        incomplete: result.incomplete,
      }
    } else {
      const result = await ingestValidatedUrl(checked, orgId, url.trim())
      return { created: result.created, skipped: result.skipped ? 1 : 0 }
    }
  } catch (err) {
    if (err instanceof IngestLimitError || err instanceof UrlValidationError) return { error: err.message }
    if (err instanceof NoAIProviderConfiguredError) {
      return { error: aiUnavailableMessage(err, 'No AI provider is set up for this workspace. Add one in Settings → AI Model, then import again.') }
    }
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('API key is missing') || msg.includes('AI_LoadAPIKeyError')) {
      return { error: 'No AI provider configured. Add OPENAI_API_KEY to your environment variables, or configure a provider in Settings → AI Model.' }
    }
    if (msg.includes('Rate limit exceeded') || msg.includes('FirecrawlSdkError')) {
      return { error: 'Import rate limit exceeded. Wait a minute and try again, or use Single page mode instead of Entire site.' }
    }
    logger.error('ingest-url failed', { module: 'actions/ingest-url', error: err })
    return { error: 'Import failed. Check the URL and try again.' }
  }
}
