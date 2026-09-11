import { describe, expect, it } from 'vitest'
import { GITHUB_URL } from '@/lib/site'
import { ORGANIZATION_ID, siteIdentityJsonLd } from '@/lib/site-identity'

describe('public site identity graph', () => {
  it('connects the organization, repository, website, and documentation', () => {
    const graph = siteIdentityJsonLd['@graph']
    const organization = graph.find((entry) => entry['@type'] === 'Organization')
    const website = graph.find((entry) => entry['@type'] === 'WebSite')
    const docs = graph.find((entry) => entry['@type'] === 'WebPage')

    expect(organization).toMatchObject({
      '@id': ORGANIZATION_ID,
      name: 'answerLoops',
      url: 'https://answerloops.com',
      sameAs: [GITHUB_URL],
    })
    expect(website).toMatchObject({
      publisher: { '@id': ORGANIZATION_ID },
    })
    expect(docs).toMatchObject({
      url: 'https://answerloops.com/docs',
      about: { '@id': ORGANIZATION_ID },
      isPartOf: { '@id': 'https://answerloops.com/#website' },
    })
  })
})
