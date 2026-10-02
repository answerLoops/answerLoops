import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BlogPostOgImage, { contentType, size } from '@/app/blog/[slug]/opengraph-image'

const { getPage, captures } = vi.hoisted(() => ({
  getPage: vi.fn(),
  captures: [] as { element: ReactElement; options: { width: number; height: number } }[],
}))

// Keep getBlogPost real so its publication rules are exercised by the route.
vi.mock('@/lib/blog/source', () => ({ blogSource: { getPage } }))
vi.mock('next/og', () => ({
  ImageResponse: vi.fn(function (element: ReactElement, options: { width: number; height: number }) {
    captures.push({ element, options })
  }),
}))

function publishedPost(title = 'A grounded answer', category = 'Product') {
  return { data: { title, category, draft: false } }
}

async function renderCover(slug: string) {
  await BlogPostOgImage({ params: Promise.resolve({ slug }) })
  const captured = captures.at(-1)!
  return { ...captured, markup: renderToStaticMarkup(captured.element) }
}

beforeEach(() => {
  captures.length = 0
  getPage.mockReset()
})

describe('blog cover image route', () => {
  it('selects the complete draft-and-review artwork for the published first cover', async () => {
    getPage.mockReturnValue(publishedPost())
    const { markup, options } = await renderCover('dual-agent-review')

    expect(getPage).toHaveBeenCalledWith(['dual-agent-review'])
    expect(markup).toContain('Good answers deserve')
    expect(markup).toContain('a second look.')
    expect(markup).toContain('Draft')
    expect(markup).toContain('Review')
    expect(markup).toContain('From your knowledge')
    expect(markup).toContain('Checked against sources')
    expect(markup).not.toContain('BEHIND THE LOOP')
    expect(markup).toContain('data:image/png;base64,')
    expect(options).toEqual({ width: 1200, height: 630 })
    expect(size).toEqual(options)
    expect(contentType).toBe('image/png')
  })

  it.each([
    ['absent', undefined],
    ['draft', { data: { ...publishedPost().data, title: 'Unpublished article', draft: true } }],
  ])('keeps the generic cover when the first post is %s', async (_, page) => {
    getPage.mockReturnValue(page)
    const { markup } = await renderCover('dual-agent-review')

    expect(markup).toContain('Blog')
    expect(markup).toContain('answerloops.com/blog')
    expect(markup).not.toContain('Good answers deserve')
    expect(markup).not.toContain('Checked against sources')
    expect(markup).not.toContain('Unpublished article')
    expect(markup).not.toContain('data:image/png;base64,')
  })

  it('selects the connected-knowledge artwork for the published MCP post', async () => {
    getPage.mockReturnValue(publishedPost('MCP server for support'))
    const { markup, options } = await renderCover('mcp-server-for-support')

    expect(getPage).toHaveBeenCalledWith(['mcp-server-for-support'])
    for (const label of ['Your knowledge.', 'Within reach.', 'Your agent', 'Knowledge', 'Tickets', 'Answers', 'Support, connected through MCP.']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('data:image/png;base64,')
    expect(markup).not.toContain('Good answers deserve')
    expect(markup).not.toContain('BEHIND THE LOOP')
    expect(options).toEqual({ width: 1200, height: 630 })
  })

  it.each([
    ['absent', undefined],
    ['draft', { data: { ...publishedPost().data, title: 'Unpublished MCP article', draft: true } }],
  ])('keeps the generic cover when the MCP post is %s', async (_, page) => {
    getPage.mockReturnValue(page)
    const { markup } = await renderCover('mcp-server-for-support')

    expect(markup).toContain('Blog')
    expect(markup).toContain('answerloops.com/blog')
    expect(markup).not.toContain('Your knowledge.')
    expect(markup).not.toContain('Within reach.')
    expect(markup).not.toContain('Unpublished MCP article')
    expect(markup).not.toContain('data:image/png;base64,')
  })

  it('gives the MCP cover a distinct gradient while retaining the shared branded frame', async () => {
    getPage.mockReturnValue(publishedPost())
    const first = await renderCover('dual-agent-review')
    const second = await renderCover('mcp-server-for-support')
    const gradient = (markup: string) => markup.match(/background-image:([^;"]+)/)?.[1]

    expect(gradient(first.markup)).toContain('radial-gradient(')
    expect(gradient(second.markup)).toContain('radial-gradient(')
    expect(gradient(second.markup)).not.toBe(gradient(first.markup))
    for (const { markup } of [first, second]) {
      expect(markup).toContain('answerloops.com')
      expect(markup).toContain('data:image/png;base64,')
      expect(markup).toContain('color:#082e50')
    }
  })

  it('selects the community question-and-answer artwork for the published Circle post', async () => {
    getPage.mockReturnValue(publishedPost('Circle community support'))
    const { markup, options } = await renderCover('circle-community-support')

    expect(getPage).toHaveBeenCalledWith(['circle-community-support'])
    for (const label of ['More community.', 'Less answering on repeat.', 'A question in Circle', 'Where do I find the course?', 'From your knowledge base', 'Here’s your getting-started guide.']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('Helpful answers, right inside your Circle community.')
    expect(markup).toContain('data:image/png;base64,')
    expect(markup).not.toContain('Good answers deserve')
    expect(markup).not.toContain('Within reach.')
    expect(markup).not.toContain('BEHIND THE LOOP')
    expect(options).toEqual({ width: 1200, height: 630 })
  })

  it.each([
    ['absent', undefined],
    ['draft', { data: { ...publishedPost().data, title: 'Unpublished Circle article', draft: true } }],
  ])('keeps the generic cover when the Circle post is %s', async (_, page) => {
    getPage.mockReturnValue(page)
    const { markup } = await renderCover('circle-community-support')

    expect(markup).toContain('Blog')
    expect(markup).toContain('answerloops.com/blog')
    expect(markup).not.toContain('More community.')
    expect(markup).not.toContain('Less answering on repeat.')
    expect(markup).not.toContain('Unpublished Circle article')
    expect(markup).not.toContain('data:image/png;base64,')
  })

  it('gives the Circle cover its own gradient while preserving the common brand', async () => {
    getPage.mockReturnValue(publishedPost())
    const first = await renderCover('dual-agent-review')
    const second = await renderCover('mcp-server-for-support')
    const circle = await renderCover('circle-community-support')
    const gradient = (markup: string) => markup.match(/background-image:([^;"]+)/)?.[1]

    expect(gradient(circle.markup)).toContain('radial-gradient(')
    expect(gradient(circle.markup)).not.toBe(gradient(first.markup))
    expect(gradient(circle.markup)).not.toBe(gradient(second.markup))
    expect(circle.markup).toContain('answerloops.com')
    expect(circle.markup).toContain('data:image/png;base64,')
    expect(circle.markup).toContain('color:#082e50')
  })

  it('selects the channel-and-thread artwork for the published Discord post', async () => {
    getPage.mockReturnValue(publishedPost('Discord community support'))
    const { markup, options } = await renderCover('discord-community-support')

    expect(getPage).toHaveBeenCalledWith(['discord-community-support'])
    for (const label of ['Discord questions.', 'Answered', 'in context.', 'Text channels + forum threads', 'getting-started', 'How do I get started?', 'Reply in the same thread']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('Support that stays with the conversation.')
    expect(markup).toContain('data:image/png;base64,')
    expect(markup).not.toContain('Good answers deserve')
    expect(markup).not.toContain('Within reach.')
    expect(markup).not.toContain('More community.')
    expect(markup).not.toContain('BEHIND THE LOOP')
    expect(options).toEqual({ width: 1200, height: 630 })
  })

  it.each([
    ['absent', undefined],
    ['draft', { data: { ...publishedPost().data, title: 'Unpublished Discord article', draft: true } }],
  ])('keeps the generic cover when the Discord post is %s', async (_, page) => {
    getPage.mockReturnValue(page)
    const { markup } = await renderCover('discord-community-support')

    expect(markup).toContain('Blog')
    expect(markup).toContain('answerloops.com/blog')
    expect(markup).not.toContain('Discord questions.')
    expect(markup).not.toContain('Reply in the same thread')
    expect(markup).not.toContain('Unpublished Discord article')
    expect(markup).not.toContain('data:image/png;base64,')
  })

  it('gives the Discord cover a distinct gradient from all earlier covers', async () => {
    getPage.mockReturnValue(publishedPost())
    const discord = await renderCover('discord-community-support')
    const gradient = (markup: string) => markup.match(/background-image:([^;"]+)/)?.[1]

    expect(gradient(discord.markup)).toContain('radial-gradient(')
    for (const slug of ['dual-agent-review', 'mcp-server-for-support', 'circle-community-support']) {
      const previous = await renderCover(slug)
      expect(gradient(discord.markup)).not.toBe(gradient(previous.markup))
    }
    expect(discord.markup).toContain('answerloops.com')
    expect(discord.markup).toContain('data:image/png;base64,')
    expect(discord.markup).toContain('color:#082e50')
  })

  it('selects the knowledge-and-topic artwork for the published Discourse post', async () => {
    getPage.mockReturnValue(publishedPost('Discourse forum support'))
    const { markup, options } = await renderCover('discourse-forum-support')

    expect(getPage).toHaveBeenCalledWith(['discourse-forum-support'])
    for (const label of ['Old questions.', 'Fresh answers.', 'Setup guide', 'Past discussions', 'A new topic in Discourse', 'How do I set this up?', 'Answered from your knowledge']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('Bring your knowledge into every new Discourse topic.')
    expect(markup).toContain('data:image/png;base64,')
    for (const priorHeadline of ['Good answers deserve', 'Within reach.', 'More community.', 'Discord questions.']) {
      expect(markup).not.toContain(priorHeadline)
    }
    expect(markup).not.toContain('BEHIND THE LOOP')
    expect(options).toEqual({ width: 1200, height: 630 })
  })

  it.each([
    ['absent', undefined],
    ['draft', { data: { ...publishedPost().data, title: 'Unpublished Discourse article', draft: true } }],
  ])('keeps the generic cover when the Discourse post is %s', async (_, page) => {
    getPage.mockReturnValue(page)
    const { markup } = await renderCover('discourse-forum-support')

    expect(markup).toContain('Blog')
    expect(markup).toContain('answerloops.com/blog')
    expect(markup).not.toContain('Old questions.')
    expect(markup).not.toContain('Fresh answers.')
    expect(markup).not.toContain('Unpublished Discourse article')
    expect(markup).not.toContain('data:image/png;base64,')
  })

  it('gives the Discourse cover a lavender gradient distinct from all earlier covers', async () => {
    getPage.mockReturnValue(publishedPost())
    const discourse = await renderCover('discourse-forum-support')
    const gradient = (markup: string) => markup.match(/background-image:([^;"]+)/)?.[1]

    expect(gradient(discourse.markup)).toContain('radial-gradient(')
    expect(gradient(discourse.markup)).toContain('#d8c7f2')
    for (const slug of ['dual-agent-review', 'mcp-server-for-support', 'circle-community-support', 'discord-community-support']) {
      const previous = await renderCover(slug)
      expect(gradient(discourse.markup)).not.toBe(gradient(previous.markup))
    }
    expect(discourse.markup).toContain('answerloops.com')
    expect(discourse.markup).toContain('data:image/png;base64,')
    expect(discourse.markup).toContain('color:#082e50')
  })

  it('selects the inbox-to-reply artwork for the published email post', async () => {
    getPage.mockReturnValue(publishedPost('Email support automation'))
    const { markup, options } = await renderCover('email-support-automation')

    expect(getPage).toHaveBeenCalledWith(['email-support-automation'])
    for (const label of ['From inbox to', 'answered.', 'Every message. One place to follow through.', 'Reply ready', 'Same conversation.']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('Email support, with the whole conversation attached.')
    expect(markup).toContain('data:image/png;base64,')
    for (const priorHeadline of ['Good answers deserve', 'Within reach.', 'More community.', 'Discord questions.', 'Old questions.']) {
      expect(markup).not.toContain(priorHeadline)
    }
    expect(markup).not.toContain('BEHIND THE LOOP')
    expect(options).toEqual({ width: 1200, height: 630 })
  })

  it.each([
    ['absent', undefined],
    ['draft', { data: { ...publishedPost().data, title: 'Unpublished email article', draft: true } }],
  ])('keeps the generic cover when the email post is %s', async (_, page) => {
    getPage.mockReturnValue(page)
    const { markup } = await renderCover('email-support-automation')

    expect(markup).toContain('Blog')
    expect(markup).toContain('answerloops.com/blog')
    expect(markup).not.toContain('From inbox to')
    expect(markup).not.toContain('Reply ready')
    expect(markup).not.toContain('Unpublished email article')
    expect(markup).not.toContain('data:image/png;base64,')
  })

  it('gives the email cover a distinct gradient from all earlier covers', async () => {
    getPage.mockReturnValue(publishedPost())
    const email = await renderCover('email-support-automation')
    const gradient = (markup: string) => markup.match(/background-image:([^;"]+)/)?.[1]

    expect(gradient(email.markup)).toContain('radial-gradient(')
    for (const slug of ['dual-agent-review', 'mcp-server-for-support', 'circle-community-support', 'discord-community-support', 'discourse-forum-support']) {
      const previous = await renderCover(slug)
      expect(gradient(email.markup)).not.toBe(gradient(previous.markup))
    }
    expect(email.markup).toContain('answerloops.com')
    expect(email.markup).toContain('data:image/png;base64,')
    expect(email.markup).toContain('color:#082e50')
  })

  it('selects the docs-and-question artwork for the published GitHub post', async () => {
    getPage.mockReturnValue(publishedPost('GitHub open source support'))
    const { markup, options } = await renderCover('github-open-source-support')

    expect(getPage).toHaveBeenCalledWith(['github-open-source-support'])
    for (const label of ['More building.', 'Less repeating.', 'GitHub Issues + Discussions', 'README.md', 'A community question', 'configure this?', 'Answered from your docs']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('Help your community. Keep building your project.')
    expect(markup).toContain('data:image/png;base64,')
    for (const priorHeadline of ['Good answers deserve', 'Within reach.', 'More community.', 'Discord questions.', 'Old questions.', 'From inbox to']) {
      expect(markup).not.toContain(priorHeadline)
    }
    expect(markup).not.toContain('BEHIND THE LOOP')
    expect(options).toEqual({ width: 1200, height: 630 })
  })

  it.each([
    ['absent', undefined],
    ['draft', { data: { ...publishedPost().data, title: 'Unpublished GitHub article', draft: true } }],
  ])('keeps the generic cover when the GitHub post is %s', async (_, page) => {
    getPage.mockReturnValue(page)
    const { markup } = await renderCover('github-open-source-support')

    expect(markup).toContain('Blog')
    expect(markup).toContain('answerloops.com/blog')
    expect(markup).not.toContain('More building.')
    expect(markup).not.toContain('Less repeating.')
    expect(markup).not.toContain('Unpublished GitHub article')
    expect(markup).not.toContain('data:image/png;base64,')
  })

  it('gives the GitHub cover a distinct gradient from all earlier covers', async () => {
    getPage.mockReturnValue(publishedPost())
    const github = await renderCover('github-open-source-support')
    const gradient = (markup: string) => markup.match(/background-image:([^;"]+)/)?.[1]

    expect(gradient(github.markup)).toContain('radial-gradient(')
    for (const slug of ['dual-agent-review', 'mcp-server-for-support', 'circle-community-support', 'discord-community-support', 'discourse-forum-support', 'email-support-automation']) {
      const previous = await renderCover(slug)
      expect(gradient(github.markup)).not.toBe(gradient(previous.markup))
    }
    expect(github.markup).toContain('answerloops.com')
    expect(github.markup).toContain('data:image/png;base64,')
    expect(github.markup).toContain('color:#082e50')
  })

  it('selects the team-help artwork for the published Google Chat post', async () => {
    getPage.mockReturnValue(publishedPost('Google Chat open source support'))
    const { markup, options } = await renderCover('google-chat-internal-support')

    expect(getPage).toHaveBeenCalledWith(['google-chat-internal-support'])
    for (const label of ['Team questions.', 'One helpful space.', 'Internal support in Google Chat', 'Team help', 'Where do I start?', 'onboarding guide.']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('Internal support, right where your team talks.')
    expect(markup).toContain('data:image/png;base64,')
    for (const priorHeadline of ['Good answers deserve', 'Within reach.', 'More community.', 'Discord questions.', 'Old questions.', 'From inbox to']) {
      expect(markup).not.toContain(priorHeadline)
    }
    expect(markup).not.toContain('BEHIND THE LOOP')
    expect(options).toEqual({ width: 1200, height: 630 })
  })

  it.each([
    ['absent', undefined],
    ['draft', { data: { ...publishedPost().data, title: 'Unpublished Google Chat article', draft: true } }],
  ])('keeps the generic cover when the Google Chat post is %s', async (_, page) => {
    getPage.mockReturnValue(page)
    const { markup } = await renderCover('google-chat-internal-support')

    expect(markup).toContain('Blog')
    expect(markup).toContain('answerloops.com/blog')
    expect(markup).not.toContain('Team questions.')
    expect(markup).not.toContain('One helpful space.')
    expect(markup).not.toContain('Unpublished Google Chat article')
    expect(markup).not.toContain('data:image/png;base64,')
  })

  it('gives the Google Chat cover a distinct gradient from all earlier covers', async () => {
    getPage.mockReturnValue(publishedPost())
    const googlechat = await renderCover('google-chat-internal-support')
    const gradient = (markup: string) => markup.match(/background-image:([^;"]+)/)?.[1]

    expect(gradient(googlechat.markup)).toContain('radial-gradient(')
    for (const slug of ['dual-agent-review', 'mcp-server-for-support', 'circle-community-support', 'discord-community-support', 'discourse-forum-support', 'email-support-automation']) {
      const previous = await renderCover(slug)
      expect(gradient(googlechat.markup)).not.toBe(gradient(previous.markup))
    }
    expect(googlechat.markup).toContain('answerloops.com')
    expect(googlechat.markup).toContain('data:image/png;base64,')
    expect(googlechat.markup).toContain('color:#082e50')
  })

  it('selects the published-guide artwork for the published Notion post', async () => {
    getPage.mockReturnValue(publishedPost('Notion open source support'))
    const { markup, options } = await renderCover('notion-knowledge-base-sync')

    expect(getPage).toHaveBeenCalledWith(['notion-knowledge-base-sync'])
    for (const label of ['Your docs.', 'Put to work.', 'Getting started', 'Shared from Notion', 'Published', 'A helpful answer']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('The pages you maintain. The answers people need.')
    expect(markup).toContain('data:image/png;base64,')
    for (const priorHeadline of ['Good answers deserve', 'Within reach.', 'More community.', 'Discord questions.', 'Old questions.', 'From inbox to']) {
      expect(markup).not.toContain(priorHeadline)
    }
    expect(markup).not.toContain('BEHIND THE LOOP')
    expect(options).toEqual({ width: 1200, height: 630 })
  })

  it.each([
    ['absent', undefined],
    ['draft', { data: { ...publishedPost().data, title: 'Unpublished Notion article', draft: true } }],
  ])('keeps the generic cover when the Notion post is %s', async (_, page) => {
    getPage.mockReturnValue(page)
    const { markup } = await renderCover('notion-knowledge-base-sync')

    expect(markup).toContain('Blog')
    expect(markup).toContain('answerloops.com/blog')
    expect(markup).not.toContain('Your docs.')
    expect(markup).not.toContain('Put to work.')
    expect(markup).not.toContain('Unpublished Notion article')
    expect(markup).not.toContain('data:image/png;base64,')
  })

  it('gives the Notion cover a distinct gradient from all earlier covers', async () => {
    getPage.mockReturnValue(publishedPost())
    const notion = await renderCover('notion-knowledge-base-sync')
    const gradient = (markup: string) => markup.match(/background-image:([^;"]+)/)?.[1]

    expect(gradient(notion.markup)).toContain('radial-gradient(')
    for (const slug of ['dual-agent-review', 'mcp-server-for-support', 'circle-community-support', 'discord-community-support', 'discourse-forum-support', 'email-support-automation', 'github-open-source-support', 'google-chat-internal-support']) {
      const previous = await renderCover(slug)
      expect(gradient(notion.markup)).not.toBe(gradient(previous.markup))
    }
    expect(notion.markup).toContain('answerloops.com')
    expect(notion.markup).toContain('data:image/png;base64,')
    expect(notion.markup).toContain('color:#082e50')
  })

  it('selects the channel-answer artwork for the published Slack post', async () => {
    getPage.mockReturnValue(publishedPost('Slack open source support'))
    const { markup, options } = await renderCover('slack-no-admin-approval')

    expect(getPage).toHaveBeenCalledWith(['slack-no-admin-approval'])
    for (const label of ['Less searching.', 'More answering.', '# ask-the-team', 'setup guide?', 'From your knowledge base', 'get started.']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('Helpful answers, in the channels your team already uses.')
    expect(markup).toContain('data:image/png;base64,')
    for (const priorHeadline of ['Good answers deserve', 'Within reach.', 'More community.', 'Discord questions.', 'Old questions.', 'From inbox to']) {
      expect(markup).not.toContain(priorHeadline)
    }
    expect(markup).not.toContain('BEHIND THE LOOP')
    expect(options).toEqual({ width: 1200, height: 630 })
  })

  it.each([
    ['absent', undefined],
    ['draft', { data: { ...publishedPost().data, title: 'Unpublished Slack article', draft: true } }],
  ])('keeps the generic cover when the Slack post is %s', async (_, page) => {
    getPage.mockReturnValue(page)
    const { markup } = await renderCover('slack-no-admin-approval')

    expect(markup).toContain('Blog')
    expect(markup).toContain('answerloops.com/blog')
    expect(markup).not.toContain('Less searching.')
    expect(markup).not.toContain('More answering.')
    expect(markup).not.toContain('Unpublished Slack article')
    expect(markup).not.toContain('data:image/png;base64,')
  })

  it('gives the Slack cover a distinct gradient from all earlier covers', async () => {
    getPage.mockReturnValue(publishedPost())
    const slack = await renderCover('slack-no-admin-approval')
    const gradient = (markup: string) => markup.match(/background-image:([^;"]+)/)?.[1]

    expect(gradient(slack.markup)).toContain('radial-gradient(')
    for (const slug of ['dual-agent-review', 'mcp-server-for-support', 'circle-community-support', 'discord-community-support', 'discourse-forum-support', 'email-support-automation', 'github-open-source-support', 'google-chat-internal-support', 'notion-knowledge-base-sync']) {
      const previous = await renderCover(slug)
      expect(gradient(slack.markup)).not.toBe(gradient(previous.markup))
    }
    expect(slack.markup).toContain('answerloops.com')
    expect(slack.markup).toContain('data:image/png;base64,')
    expect(slack.markup).toContain('color:#082e50')
  })

  it('retains the title and category fallback for posts without bespoke artwork', async () => {
    getPage.mockReturnValue(publishedPost('Support across channels', 'Guides'))
    const { markup } = await renderCover('support-across-channels')

    expect(markup).toContain('Support across channels')
    expect(markup).toContain('Guides')
    expect(markup).toContain('answerloops.com/blog')
    expect(markup).not.toContain('Good answers deserve')
    expect(markup).not.toContain('<svg')
  })

  it.each([
    ['telegram-community-support', '#229ed9'],
  ])('preserves the integration mark on %s', async (slug, brandColor) => {
    getPage.mockReturnValue(publishedPost('Integration guide', 'Integrations'))
    const { markup } = await renderCover(slug)

    expect(markup).toContain('Integration guide')
    expect(markup).toContain('Integrations')
    expect(markup).toContain('<svg')
    expect(markup).toContain('<path')
    expect(markup).toContain(brandColor)
    expect(markup).not.toContain('Good answers deserve')
  })

  it.each(['dual-agent-review', 'mcp-server-for-support', 'circle-community-support', 'discord-community-support', 'discourse-forum-support', 'email-support-automation', 'github-open-source-support', 'google-chat-internal-support', 'notion-knowledge-base-sync', 'slack-no-admin-approval'])('renders %s through the real image engine as a 1200 × 630 PNG', async (slug) => {
    getPage.mockReturnValue(publishedPost())
    const { element, options } = await renderCover(slug)
    const { ImageResponse } = await vi.importActual<typeof import('next/og')>('next/og')
    const response = new ImageResponse(element, options)
    const png = Buffer.from(await response.arrayBuffer())

    expect(response.headers.get('content-type')).toBe('image/png')
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(png.toString('ascii', 12, 16)).toBe('IHDR')
    expect(png.readUInt32BE(16)).toBe(1200)
    expect(png.readUInt32BE(20)).toBe(630)
  }, 15000)
})
