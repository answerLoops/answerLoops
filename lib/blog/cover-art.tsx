import type { ReactNode } from 'react'

// All covers share the public site's palette and a 1200 × 630 canvas.
export const BLOG_COVER_SIZE = { width: 1200, height: 630 }
export const coverPalette = {
  navy: '#082e50',
  teal: '#168fa3',
  aqua: '#b9e0e5',
  paleAqua: '#eef7f7',
  sand: '#faf4e8',
  muted: '#5d6b7c',
}

/** Inline styles keep the same React artwork usable in image generation. */
export function BlogCoverFrame({
  children,
  logoSrc,
  caption,
  backgroundImage = 'radial-gradient(ellipse at 12% 0%, #faf4e8 0%, rgba(250,244,232,0) 66%), radial-gradient(ellipse at 88% 92%, #98d6df 0%, rgba(152,214,223,0) 65%), linear-gradient(135deg, #eef7f7, #dceff0)',
}: {
  children: ReactNode
  logoSrc: string
  caption: string
  backgroundImage?: string
}) {
  return (
    <div style={{
      ...BLOG_COVER_SIZE,
      position: 'relative', display: 'flex', overflow: 'hidden',
      fontFamily: 'sans-serif', color: coverPalette.navy,
      backgroundColor: coverPalette.paleAqua,
      backgroundImage,
    }}>
      <div style={{ position: 'absolute', right: -185, top: -245, width: 650, height: 650, borderRadius: '50%', border: '2px solid #ffffff66' }} />
      <div style={{ position: 'absolute', left: -310, bottom: -415, width: 700, height: 700, borderRadius: '50%', border: '2px solid #ffffff66' }} />
      <div style={{ position: 'absolute', top: 40, left: 78, right: 78, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 32, fontWeight: 700, letterSpacing: -1 }}>
          {/* Image generation requires a plain image with explicit dimensions. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} alt="" width={50} height={50} style={{ marginRight: 10 }} />
          answer<span style={{ color: coverPalette.teal }}>Loops</span>
        </div>
      </div>
      {children}
      <div style={{ position: 'absolute', bottom: 30, left: 78, right: 78, display: 'flex', justifyContent: 'space-between', fontSize: 17, color: '#496575' }}>
        <span>{caption}</span><span>answerloops.com</span>
      </div>
    </div>
  )
}

export function McpSupportCover({ logoSrc }: { logoSrc: string }) {
  return (
    <BlogCoverFrame
      logoSrc={logoSrc}
      caption="Connect your agent to your support knowledge."
      backgroundImage="radial-gradient(ellipse at 0% 5%, #8bcbd2 0%, rgba(139,203,210,0) 64%), radial-gradient(ellipse at 100% 100%, #f2dfbc 0%, rgba(242,223,188,0) 68%), linear-gradient(35deg, #eef7f7, #faf4e8)"
    >
      <div style={{ position: 'absolute', left: 78, top: 222, display: 'flex', flexDirection: 'column', fontSize: 58, lineHeight: 1.12, letterSpacing: -2 }}>
        <span>Your knowledge.</span>
        <span style={{ color: '#168193' }}>Within reach.</span>
      </div>
      <div style={{ position: 'absolute', left: 80, top: 383, display: 'flex', fontSize: 23, color: '#496575' }}>Support, connected through MCP.</div>
      <svg width="510" height="360" viewBox="0 0 510 360" style={{ position: 'absolute', left: 620, top: 155 }}>
        <path d="M100 180H225V58H290M225 180H290M225 180V302H290" fill="none" stroke="#72aeb9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="225" cy="180" r="6" fill="#168fa3" />
      </svg>
      <div style={{ position: 'absolute', left: 625, top: 265, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, width: 144, height: 144, borderRadius: 36, background: coverPalette.navy, boxShadow: '0 14px 32px #082e5018', color: 'white' }}>
        <svg width="38" height="38" viewBox="0 0 38 38"><path d="M10 7V19C10 26 16 31 23 31H30M10 7L4 13M10 7L16 13M30 31L24 25M30 31L24 37" fill="none" stroke="#b9e0e5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span style={{ fontSize: 25 }}>Your agent</span>
      </div>
      {[
        { title: 'Knowledge', detail: 'Find the right source', top: 170 },
        { title: 'Tickets', detail: 'Keep the context', top: 292 },
        { title: 'Answers', detail: 'Grounded in your docs', top: 414 },
      ].map(({ title, detail, top }) => (
        <div key={title} style={{ position: 'absolute', left: 910, top, display: 'flex', flexDirection: 'column', justifyContent: 'center', width: 224, height: 88, paddingLeft: 22, borderRadius: 16, background: '#ffffffed', border: '2px solid white', boxShadow: '0 8px 24px #082e5007' }}>
          <span style={{ fontSize: 24, color: coverPalette.navy }}>{title}</span>
          <span style={{ fontSize: 15, color: coverPalette.muted, marginTop: 5 }}>{detail}</span>
        </div>
      ))}
    </BlogCoverFrame>
  )
}

export function DualAgentReviewCover({ logoSrc }: { logoSrc: string }) {
  return (
    <BlogCoverFrame logoSrc={logoSrc} caption="Two agents. One thoughtful answer.">
      <div style={{ position: 'absolute', left: 78, top: 136, display: 'flex', flexDirection: 'column', fontSize: 64, lineHeight: 1.06, letterSpacing: -2 }}>
        <span>Good answers deserve</span>
        <span style={{ color: '#168193' }}>a second look.</span>
      </div>
      <div style={{ position: 'absolute', left: 252, top: 330, display: 'flex', flexDirection: 'column', width: 296, height: 198, padding: 22, borderRadius: 16, background: '#fffffff0', border: '2px solid white', transform: 'rotate(-5deg)', boxShadow: '0 12px 30px #082e5009' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 24 }}><span style={{ color: coverPalette.muted, fontSize: 16 }}>01</span>Draft</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
          <div style={{ height: 8, width: 245, borderRadius: 4, background: '#dce2e9' }} />
          <div style={{ height: 8, width: 200, borderRadius: 4, background: '#dce2e9' }} />
          <div style={{ height: 8, width: 144, borderRadius: 4, background: '#dce2e9' }} />
        </div>
        <div style={{ display: 'flex', position: 'absolute', left: 22, bottom: 18, color: coverPalette.muted, fontSize: 15 }}>From your knowledge</div>
      </div>
      <svg width="128" height="50" viewBox="0 0 128 50" style={{ position: 'absolute', left: 580, top: 405 }}>
        <path d="M4 25H120M108 14L120 25L108 36" fill="none" stroke={coverPalette.teal} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div style={{ position: 'absolute', left: 746, top: 330, display: 'flex', flexDirection: 'column', width: 296, height: 198, padding: 22, borderRadius: 16, background: '#fffffff0', border: '2px solid white', transform: 'rotate(4deg)', boxShadow: '0 12px 30px #082e5009' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 24 }}><span style={{ color: coverPalette.muted, fontSize: 16 }}>02</span>Review</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 18 }}>
          {[190, 190, 132].map((width, index) => <div key={index} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 8L6 12L14 3" fill="none" stroke={coverPalette.teal} strokeWidth="2" /></svg>
            <div style={{ height: 8, width, borderRadius: 4, background: coverPalette.aqua }} />
          </div>)}
        </div>
        <div style={{ display: 'flex', position: 'absolute', left: 22, bottom: 18, color: coverPalette.muted, fontSize: 15 }}>Checked against sources</div>
      </div>
      <div style={{ position: 'absolute', left: 999, top: 304, width: 62, height: 62, borderRadius: '50%', background: coverPalette.navy, border: '4px solid #dceff0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="28" height="28" viewBox="0 0 28 28"><path d="M4 14L11 21L24 6" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
    </BlogCoverFrame>
  )
}
