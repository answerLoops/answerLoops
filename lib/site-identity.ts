import { GITHUB_URL } from '@/lib/site'

export const ORGANIZATION_ID = 'https://answerloops.com/#organization'
export const WEBSITE_ID = 'https://answerloops.com/#website'

/**
 * The canonical public identity graph shared by every crawlable route.
 *
 * Keep this limited to relationships that answerLoops can verify and control:
 * the canonical site, repository, documentation, logo, and support contact.
 * Additional social profiles belong here only once they are official and
 * maintained by the project.
 */
export const siteIdentityJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': ORGANIZATION_ID,
      name: 'answerLoops',
      url: 'https://answerloops.com',
      logo: {
        '@type': 'ImageObject',
        url: 'https://answerloops.com/logo.png',
      },
      description:
        'Open-source support software for preparing and reviewing answers from workspace documentation across connected community channels.',
      sameAs: [GITHUB_URL],
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: 'support@answerloops.com',
        url: 'https://answerloops.com/docs',
      },
    },
    {
      '@type': 'WebSite',
      '@id': WEBSITE_ID,
      name: 'answerLoops',
      url: 'https://answerloops.com',
      publisher: { '@id': ORGANIZATION_ID },
    },
    {
      '@type': 'WebPage',
      '@id': 'https://answerloops.com/docs',
      name: 'answerLoops Documentation',
      url: 'https://answerloops.com/docs',
      isPartOf: { '@id': WEBSITE_ID },
      about: { '@id': ORGANIZATION_ID },
    },
  ],
} as const
