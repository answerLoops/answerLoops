import { ImageResponse } from 'next/og'
import { getBlogPost } from '@/lib/blog/posts'

// Auto-generated cover art: a post only needs a `coverImage` in its
// frontmatter if it wants a specific photo/illustration. Without one, this
// route renders a title+category card so publishing a new SEO post never
// blocks on producing an image. Colors match the answerLoops branding guide
// (marketing-navy #082e50, marketing-accent #168fa3, marketing-soft #f5f7fa).
// Integration posts additionally get that platform's own recognizable mark —
// the branding guide calls out keeping real integration brand colors rather
// than flattening every channel icon to the site accent.
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Path data mirrors components/marketing/integration-icon.tsx. Duplicated
// here (rather than imported) because next/og's Satori renderer doesn't
// process Tailwind classes — every icon needs explicit width/height/fill
// instead of the className the site component uses.
const INTEGRATION_MARKS: Record<
  string,
  {
    color: string
    viewBox: string
    paths: { d: string; fill?: string; stroke?: string }[]
  }
> = {
  'discord-community-support': {
    color: '#5865f2',
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.033.055a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z',
      },
    ],
  },
  'slack-no-admin-approval': {
    color: '#36c5f0',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M9.1 2.5a2.1 2.1 0 1 0 0 4.2h2.1V4.6a2.1 2.1 0 0 0-2.1-2.1Zm0 6.3H4.6a2.1 2.1 0 1 0 0 4.2h4.5a2.1 2.1 0 1 0 0-4.2Z', fill: '#36c5f0' },
      { d: 'M21.5 9.1a2.1 2.1 0 1 0-4.2 0v2.1h2.1a2.1 2.1 0 0 0 2.1-2.1Zm-6.3 0v4.5a2.1 2.1 0 1 0 4.2 0V9.1a2.1 2.1 0 0 0-4.2 0Z', fill: '#2eb67d' },
      { d: 'M14.9 21.5a2.1 2.1 0 1 0 0-4.2h-2.1v2.1a2.1 2.1 0 0 0 2.1 2.1Zm0-6.3h4.5a2.1 2.1 0 1 0 0-4.2h-4.5a2.1 2.1 0 0 0 0 4.2Z', fill: '#ecb22e' },
      { d: 'M2.5 14.9a2.1 2.1 0 1 0 4.2 0v-2.1H4.6a2.1 2.1 0 0 0-2.1 2.1Zm6.3 0v-4.5a2.1 2.1 0 1 0-4.2 0v4.5a2.1 2.1 0 0 0 4.2 0Z', fill: '#e01e5a' },
    ],
  },
  'discourse-forum-support': {
    color: '#e4572e',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 2a10 10 0 0 0-9.8 12.1L2 22l7.8-1.7A10 10 0 1 0 12 2Z', fill: '#e4572e' },
      { d: 'M8 7h4.3a4.2 4.2 0 1 1 0 8.4H8V7Zm2.1 1.9v4.6h2.2a2.3 2.3 0 1 0 0-4.6h-2.2Z', fill: '#ffffff' },
    ],
  },
  'circle-community-support': {
    color: '#7c3aed',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', fill: '#7c3aed' },
      { d: 'M15.7 8.1a5.1 5.1 0 1 0 0 7.8', fill: 'none', stroke: '#ffffff' },
    ],
  },
  'google-chat-internal-support': {
    color: '#34a853',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M4 4h9.5A6.5 6.5 0 0 1 20 10.5V15a5 5 0 0 1-5 5H9l-5 3v-5a5 5 0 0 1-3-4.5V9a5 5 0 0 1 3-5Z', fill: '#34a853' },
      { d: 'M7 7h8a3 3 0 0 1 3 3v3H9a2 2 0 0 1-2-2V7Z', fill: '#4285f4' },
    ],
  },
  'telegram-community-support': {
    color: '#229ed9',
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M21.7 3.3 18.5 20c-.24 1.18-.87 1.47-1.77.92l-4.86-3.58-2.35 2.26c-.26.26-.48.48-.98.48l.35-4.96 9.03-8.16c.39-.35-.09-.55-.6-.2L6.16 13.5 1.4 12.01c-1.04-.33-1.06-1.04.22-1.54L20.2 3.1c.88-.32 1.65.2 1.5.2Z',
      },
    ],
  },
  'email-support-automation': {
    color: '#64748b',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-13Z', fill: 'none' },
      { d: 'm4 7 8 6 8-6', fill: 'none' },
    ],
  },
  'github-open-source-support': {
    color: '#24292f',
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.167 6.839 9.49.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.744 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z',
      },
    ],
  },
  'notion-knowledge-base-sync': {
    color: '#000000',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M4 4.5A1.5 1.5 0 0 1 5.5 3h13A1.5 1.5 0 0 1 20 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5v-15Z', fill: '#000000' },
      { d: 'M8 7.5h1.6l5.3 7.4V7.5H16.5v9H14.9l-5.3-7.4v7.4H8v-9Z', fill: '#ffffff' },
    ],
  },
}

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
