import { publicPageMetadata } from '@/lib/marketing/metadata'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { DocsPage, DocsBody, DocsDescription, DocsTitle } from 'fumadocs-ui/page'
import { docsSource } from '@/lib/docs/source'
import { getMDXComponents } from '@/mdx-components'

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string[] }>
}) {
  const { slug } = await params
  const page = docsSource.getPage(slug)
  if (!page) notFound()

  const MDXContent = page.data.body

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDXContent components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  )
}

export async function generateStaticParams() {
  return docsSource.generateParams()
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>
}): Promise<Metadata> {
  const { slug } = await params
  const page = docsSource.getPage(slug)
  if (!page) notFound()

  return publicPageMetadata({
    title: page.data.title,
    description: page.data.description ?? 'Setup and product guides for answerLoops community support.',
    path: page.url,
  })
}
