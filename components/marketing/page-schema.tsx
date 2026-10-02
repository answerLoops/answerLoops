import { jsonLdHtml } from '@/lib/marketing/json-ld'
import { ORGANIZATION_ID, WEBSITE_ID } from '@/lib/site-identity'

interface Breadcrumb {
  name: string
  path: string
}

export interface PageSchemaProps {
  name: string
  description: string
  path: string
  breadcrumbs?: Breadcrumb[]
  type?: 'WebPage' | 'CollectionPage'
  /** Rendered as FAQPage schema when a page already shows this content as visible Q&A — never invent questions the page doesn't ask. */
  faq?: Array<{ question: string; answer: string }>
  /** Adds a TechArticle node (linked via mainEntityOfPage) for long-form technical/product docs content. */
  article?: boolean
}

export function PageSchema({ name, description, path, breadcrumbs = [], type = 'WebPage', faq = [], article = false }: PageSchemaProps) {
  const url = `https://answerloops.com${path}`
  const items = [{ name: 'answerLoops', path: '/' }, ...breadcrumbs, { name, path }]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.path === item.path) === index)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': type,
        '@id': `${url}#webpage`,
        name,
        description,
        url,
        isPartOf: { '@id': WEBSITE_ID },
        about: { '@id': ORGANIZATION_ID },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: item.name,
          item: `https://answerloops.com${item.path}`,
        })),
      },
      ...(faq.length > 0
        ? [
            {
              '@type': 'FAQPage',
              '@id': `${url}#faq`,
              mainEntity: faq.map((item) => ({
                '@type': 'Question',
                name: item.question,
                acceptedAnswer: { '@type': 'Answer', text: item.answer },
              })),
            },
          ]
        : []),
      ...(article
        ? [
            {
              '@type': 'TechArticle',
              '@id': `${url}#article`,
              headline: name,
              description,
              url,
              isPartOf: { '@id': WEBSITE_ID },
              author: { '@id': ORGANIZATION_ID },
              publisher: { '@id': ORGANIZATION_ID },
              mainEntityOfPage: { '@id': `${url}#webpage` },
            },
          ]
        : []),
    ],
  }

  // jsonLd is built entirely from server-controlled strings (page name/description/paths),
  // never user input, and jsonLdHtml escapes `<` so the payload can't break out of the script tag.
  // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
}
