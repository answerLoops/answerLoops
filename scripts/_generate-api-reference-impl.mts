/**
 * Regenerates content/docs/reference/api/**\/*.mdx from the live Agent API
 * OpenAPI spec (app/api/v1/agent/openapi.json/route.ts) — replacing the old
 * hand-written docs/reference/api-endpoints.mdx (issue #197). The route
 * handler is self-contained (no DB/env access, just builds and returns the
 * spec object), so it's imported directly rather than requiring a running
 * dev server to hit over HTTP.
 *
 * Not run directly — scripts/generate-api-reference.mjs bundles this file
 * to CommonJS with esbuild first. fumadocs-openapi's published ESM build
 * has a broken static import of one of xml-js's CJS exports (only surfaces
 * under Node's native ESM loader, which enforces named-export bindings
 * strictly; a bundler's CJS interop tolerates it fine, which is exactly
 * what Next.js itself uses at runtime — this script hits the same failure
 * mode standalone, so it gets the same bundler treatment here).
 *
 * Re-run with `pnpm docs:generate-api` whenever the Agent API surface
 * changes — the generated files are checked in like any other doc page,
 * not built on the fly, so search indexing and page tree ordering work
 * the same way as every other content/docs page.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { generateFiles } from 'fumadocs-openapi'
import { createOpenAPI } from 'fumadocs-openapi/server'
import { GET } from '../app/api/v1/agent/openapi.json/route'

async function main() {
  const response = await GET()
  const spec = await response.json()

  // Committed alongside the generated pages (not .cache/) — the generated
  // MDX files reference this path by relative string, so it has to survive
  // a fresh clone without re-running this script first.
  mkdirSync('content/docs/reference/api', { recursive: true })
  const specPath = 'content/docs/reference/api/openapi.json'
  writeFileSync(specPath, JSON.stringify(spec, null, 2))

  const openapi = createOpenAPI({
    input: [specPath],
  })

  await generateFiles({
    input: openapi,
    output: 'content/docs/reference/api',
    per: 'operation',
  })

  // generateFiles() only writes one file per operation — the section's
  // own overview page and nav ordering are hand-authored and re-written
  // here every run so `pnpm docs:migrate` (which wipes and rebuilds all of
  // content/docs from docs/docs.json) never leaves this folder without them.
  writeFileSync(
    'content/docs/reference/api/overview.mdx',
    `---
title: Agent API Reference
description: Per-endpoint parameter reference for the Agent API, generated from the live OpenAPI spec.
---

For setup, auth, curl examples, error shapes, and rate limits, see the
[Agent API guide](/docs/integrations/agent-api) — this page is just an
index into the detailed parameter reference for each endpoint below,
generated directly from the live OpenAPI spec at
[\`/api/v1/agent/openapi.json\`](/api/v1/agent/openapi.json).

<CardGroup>
  <Card title="Search the knowledge base" href="/docs/reference/api/searchKb">
    Semantically search the organization's knowledge base
  </Card>
  <Card title="Get the latest FAQ" href="/docs/reference/api/getFaq">
    Read the auto-generated FAQ for the organization
  </Card>
  <Card title="List tickets" href="/docs/reference/api/getTickets">
    List support tickets, optionally filtered by status
  </Card>
  <Card title="Create a ticket" href="/docs/reference/api/createTicket">
    File a new support ticket
  </Card>
  <Card title="Generate an answer" href="/docs/reference/api/generateAnswer">
    Run the confidence-gated answer pipeline against a question
  </Card>
</CardGroup>
`
  )
  writeFileSync(
    'content/docs/reference/api/meta.json',
    JSON.stringify(
      {
        title: 'Agent API',
        pages: ['overview', 'searchKb', 'getFaq', 'getTickets', 'createTicket', 'generateAnswer'],
      },
      null,
      2
    ) + '\n'
  )

  console.log('Generated Agent API reference pages in content/docs/reference/api/')
}

main()
