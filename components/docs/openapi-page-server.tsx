import type { OpenAPIPageProps_Spec } from 'fumadocs-openapi/ui'
import { openapi } from '@/lib/docs/openapi'
import { OpenAPIPageClient } from './openapi-page'

// The generated MDX pages pass the spec's file path as `document` plus the
// operation/webhook selection; everything except `payload` is forwarded as is.
type OpenAPIPageProps = Omit<OpenAPIPageProps_Spec, 'payload'> & {
  document: string
}

// The generated content/docs/reference/api/**\/*.mdx pages (see
// scripts/generate-api-reference.mjs) render `<Comp document="..." .../>`
// with just the spec's file path — fumadocs-openapi's client component
// needs the actual resolved schema (`payload.bundled`), not a path string.
// This server component does that lookup (via lib/docs/openapi.ts, which
// reads content/docs/reference/api/openapi.json off disk) before handing
// off to the client-rendered playground/table UI.
export default async function OpenAPIPage({ document, ...rest }: OpenAPIPageProps) {
  const schema = await openapi.getSchema(document)
  return <OpenAPIPageClient payload={{ bundled: schema.bundled }} {...rest} />
}
