import { ImageResponse } from 'next/og'
import { getBlogPost } from '@/lib/blog/posts'
import { INTEGRATION_MARKS } from '@/lib/blog/covers/marks'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BLOG_COVER_SIZE, CircleSupportCover, DiscordSupportCover, DiscourseApiCover, DiscourseSupportCover, LocalModelCover, DualAgentReviewCover, EmailSupportCover, GitHubSupportCover, GoogleChatSupportCover, McpSupportCover, NotionKnowledgeCover, SlackSupportCover, TelegramSupportCover, MultiplatformSupportCover, SupportAnswersKnowledgeCover } from '@/lib/blog/cover-art'

const COVER_ART = new Map([
  ['dual-agent-review', DualAgentReviewCover],
  ['mcp-server-for-support', McpSupportCover],
  ['circle-community-support', CircleSupportCover],
  ['discord-community-support', DiscordSupportCover],
  ['discourse-forum-support', DiscourseSupportCover],
  ['discourse-api-answer-bot', DiscourseApiCover],
  ['run-an-ai-support-bot-on-a-local-model', LocalModelCover],
  ['email-support-automation', EmailSupportCover],
  ['github-open-source-support', GitHubSupportCover],
  ['google-chat-internal-support', GoogleChatSupportCover],
  ['notion-knowledge-base-sync', NotionKnowledgeCover],
  ['slack-no-admin-approval', SlackSupportCover],
  ['telegram-community-support', TelegramSupportCover],
  ['managing-every-community-platform-from-one-place', MultiplatformSupportCover],
  ['turn-support-answers-into-reusable-knowledge', SupportAnswersKnowledgeCover],
])

// Auto-generated cover art: a post only needs a `coverImage` in its
// frontmatter if it wants a specific photo/illustration. Without one, this
// route renders a title+category card so publishing a new SEO post never
// blocks on producing an image. Colors match the answerLoops branding guide
// (marketing-navy #082e50, marketing-accent #168fa3, marketing-soft #f5f7fa).
// Integration posts additionally get that platform's own recognizable mark —
// the branding guide calls out keeping real integration brand colors rather
// than flattening every channel icon to the site accent.
export const size = BLOG_COVER_SIZE
export const contentType = 'image/png'

function IntegrationMark({ slug }: { slug: string }) {
  const mark = INTEGRATION_MARKS[slug]
  if (!mark) return null
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 120,
        height: 120,
        borderRadius: 24,
        background: '#ffffff',
        border: '1px solid #dce2e9',
      }}
    >
      <svg width="64" height="64" viewBox={mark.viewBox}>
        {mark.paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.fill ?? mark.color} stroke={p.fill === 'none' ? (p.stroke ?? mark.color) : undefined} strokeWidth={p.fill === 'none' ? 1.8 : undefined} strokeLinecap="round" />
        ))}
      </svg>
    </div>
  )
}

export default async function BlogPostOgImage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const post = getBlogPost(slug)
  const Cover = COVER_ART.get(slug)
  if (post && Cover) {
    const logo = await readFile(join(process.cwd(), 'public/icon.png'))
    // Every cover is drawn in bold Geist, so hand the font over: the image
    // renderer only ships a regular one. Geist is the site's own typeface.
    const fonts = [{ name: 'Geist', data: await readFile(join(process.cwd(), 'lib/marketing/fonts/Geist-Bold.ttf')), weight: 700 as const, style: 'normal' as const }]
    return new ImageResponse(
      <Cover logoSrc={`data:image/png;base64,${logo.toString('base64')}`} />,
      { ...size, fonts },
    )
  }
  const title = post?.data.title ?? 'answerLoops'
  const category = post?.data.category ?? 'Blog'
  const mark = INTEGRATION_MARKS[slug]

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#f5f7fa',
          color: '#082e50',
          padding: '64px 72px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 32, fontWeight: 700 }}>
            answer<span style={{ color: '#168fa3' }}>Loops</span>
          </div>
          {mark && <IntegrationMark slug={slug} />}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', fontSize: 24, color: '#168fa3', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 2 }}>
            {category}
          </div>
          <div style={{ display: 'flex', fontSize: 58, fontWeight: 700, lineHeight: 1.15, maxWidth: 1000 }}>
            {title}
          </div>
        </div>
        <div style={{ display: 'flex', borderTop: '1px solid #dce2e9', paddingTop: 20, fontSize: 24, color: '#315e81' }}>
          answerloops.com/blog
        </div>
      </div>
    ),
    size
  )
}
