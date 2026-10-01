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

export function NotionKnowledgeCover({ logoSrc }: { logoSrc: string }) {
  return (
    <BlogCoverFrame
      logoSrc={logoSrc}
      caption="The pages you maintain. The answers people need."
      backgroundImage="radial-gradient(ellipse at 0% 70%, #d5c9ec 0%, rgba(213,201,236,0) 58%), radial-gradient(ellipse at 100% 25%, #b9e0e5 0%, rgba(185,224,229,0) 58%), linear-gradient(105deg, #f4eff8, #faf4e8 60%, #eef7f7)"
    >
      <div style={{ position: 'absolute', left: 78, right: 78, top: 139, display: 'flex', justifyContent: 'center', fontSize: 58, letterSpacing: -2 }}>
        <span>Your docs.</span><span style={{ color: '#168193', marginLeft: 16 }}>Put to work.</span>
      </div>
      <div style={{ position: 'absolute', left: 78, right: 78, top: 215, display: 'flex', justifyContent: 'center', fontSize: 23, color: '#496575' }}>From Notion pages to helpful support answers</div>
      <div style={{ position: 'absolute', left: 128, top: 296, width: 310, height: 215, padding: 25, borderRadius: 18, background: '#fffffff2', border: '2px solid white', display: 'flex', flexDirection: 'column', boxShadow: '0 14px 30px #082e500a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, fontSize: 23 }}>
          <div style={{ width: 34, height: 36, border: '2px solid #202020', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#202020', fontSize: 26, fontWeight: 700 }}>N</div>
          <span>Getting started</span>
        </div>
        <div style={{ marginTop: 25, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ height: 7, width: 230, borderRadius: 4, background: '#d7dfE5' }} />
          <div style={{ height: 7, width: 196, borderRadius: 4, background: '#d7dfE5' }} />
          <div style={{ height: 7, width: 213, borderRadius: 4, background: '#d7dfE5' }} />
        </div>
        <span style={{ marginTop: 23, fontSize: 17, color: '#496575' }}>Shared from Notion</span>
      </div>
      <svg width="304" height="30" viewBox="0 0 304 30" style={{ position: 'absolute', left: 448, top: 384 }}><path d="M0 15H296M286 5l10 10-10 10" fill="none" stroke="#168fa3" strokeWidth="2" /></svg>
      <div style={{ position: 'absolute', left: 512, top: 358, width: 174, height: 82, borderRadius: 41, background: '#e3f1ef', border: '2px solid white', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <svg width="21" height="21" viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" fill="none" stroke="#168193" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span style={{ fontSize: 20, color: '#176c74' }}>Published</span>
      </div>
      <div style={{ position: 'absolute', left: 763, top: 310, width: 310, height: 195, padding: 27, borderRadius: '20px 20px 20px 4px', background: coverPalette.navy, color: 'white', display: 'flex', flexDirection: 'column', boxShadow: '0 14px 30px #082e5010' }}>
        <span style={{ color: '#b9e0e5', fontSize: 17 }}>A helpful answer</span>
        <span style={{ marginTop: 18, fontSize: 29, lineHeight: 1.2 }}>Here’s how to get started.</span>
        <span style={{ marginTop: 20, fontSize: 17, color: '#b9e0e5' }}>From your knowledge base</span>
      </div>
    </BlogCoverFrame>
  )
}

export function GoogleChatSupportCover({ logoSrc }: { logoSrc: string }) {
  return (
    <BlogCoverFrame
      logoSrc={logoSrc}
      caption="Internal support, right where your team talks."
      backgroundImage="radial-gradient(ellipse at 48% -18%, #a6dfe0 0%, rgba(166,223,224,0) 70%), radial-gradient(ellipse at 100% 110%, #d8cef1 0%, rgba(216,206,241,0) 65%), linear-gradient(155deg, #eef7f7, #faf4e8)"
    >
      <div style={{ position: 'absolute', left: 78, top: 190, display: 'flex', flexDirection: 'column', fontSize: 60, lineHeight: 1.12, letterSpacing: -2 }}>
        <span>Team questions.</span>
        <span style={{ color: '#168193' }}>One helpful space.</span>
      </div>
      <div style={{ position: 'absolute', left: 80, top: 358, display: 'flex', fontSize: 23, color: '#496575' }}>Internal support in Google Chat</div>
      <div style={{ position: 'absolute', left: 642, top: 143, width: 460, height: 344, borderRadius: 24, background: '#fffffff2', border: '2px solid white', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 38px #082e5010' }}>
        <div style={{ height: 77, padding: '0 26px', borderBottom: '1px solid #dce8e9', display: 'flex', alignItems: 'center', gap: 14, fontSize: 24 }}>
          <svg width="34" height="34" viewBox="0 0 24 24"><path d="M4 3h16v13H9l-5 5V3Z" fill="#34a853" /><path d="M4 3h16v4H4Z" fill="#a8dab5" /><path d="M8 9h8v2H8zm0 4h5v2H8z" fill="white" /></svg>
          <span>Team help</span>
        </div>
        <div style={{ margin: '25px 26px 0', padding: '17px 20px', borderRadius: '16px 16px 16px 3px', background: '#eef5f6', fontSize: 23, display: 'flex' }}>Where do I start?</div>
        <div style={{ margin: '17px 26px 0 54px', padding: '17px 20px', borderRadius: '16px 16px 3px 16px', background: coverPalette.navy, color: 'white', fontSize: 23, display: 'flex' }}>Here’s your onboarding guide.</div>
      </div>
      <div style={{ position: 'absolute', left: 729, top: 451, width: 286, height: 76, borderRadius: 16, border: '2px solid white', background: '#eee9f7', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 13, fontSize: 21, boxShadow: '0 10px 24px #082e5008' }}>
        <svg width="25" height="28" viewBox="0 0 25 28"><path d="M5 2h11l5 5v19H5V2Z" fill="white" stroke="#8f83ae" strokeWidth="1.5" /><path d="M9 11h8M9 16h8M9 21h5" stroke="#8f83ae" strokeWidth="1.5" /></svg>
        <span>Your team’s knowledge</span>
      </div>
    </BlogCoverFrame>
  )
}

export function GitHubSupportCover({ logoSrc }: { logoSrc: string }) {
  return (
    <BlogCoverFrame
      logoSrc={logoSrc}
      caption="Help your community. Keep building your project."
      backgroundImage="radial-gradient(ellipse at 18% 0%, #d8c7f2 0%, rgba(216,199,242,0) 62%), radial-gradient(ellipse at 90% 68%, #b9e0e5 0%, rgba(185,224,229,0) 62%), linear-gradient(165deg, #f3eef9, #faf4e8)"
    >
      <div style={{ position: 'absolute', left: 78, top: 212, display: 'flex', flexDirection: 'column', fontSize: 58, lineHeight: 1.12, letterSpacing: -2 }}>
        <span>More building.</span>
        <span style={{ color: '#168193' }}>Less repeating.</span>
      </div>
      <div style={{ position: 'absolute', left: 80, top: 373, display: 'flex', fontSize: 22, color: '#496575' }}>GitHub Issues + Discussions</div>
      <div style={{ position: 'absolute', left: 630, top: 155, width: 296, height: 270, display: 'flex', flexDirection: 'column', padding: 26, borderRadius: 18, background: coverPalette.navy, color: 'white', transform: 'rotate(-8deg)', boxShadow: '0 14px 30px #082e5010' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, fontSize: 21 }}>
          <span>README.md</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 15, marginTop: 32 }}>
          <div style={{ width: 204, height: 8, borderRadius: 4, background: '#b9e0e5' }} />
          <div style={{ width: 166, height: 8, borderRadius: 4, background: '#568195' }} />
          <div style={{ width: 188, height: 8, borderRadius: 4, background: '#568195' }} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 742, top: 296, width: 368, height: 224, display: 'flex', flexDirection: 'column', padding: 26, borderRadius: 20, background: '#fffffff5', border: '2px solid white', boxShadow: '0 16px 36px #082e5012', transform: 'rotate(4deg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: coverPalette.muted, fontSize: 16 }}>
          <span>A community question</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 17, fontSize: 25, lineHeight: 1.2 }}><span>How do I</span><span>configure this?</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 22, paddingTop: 17, borderTop: '1px solid #dce2e9', color: '#168193', fontSize: 18 }}>
          <svg width="21" height="21" viewBox="0 0 24 24"><path d="M4 12L9 17L21 5" fill="none" stroke={coverPalette.teal} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Answered from your docs</span>
        </div>
      </div>
    </BlogCoverFrame>
  )
}

export function EmailSupportCover({ logoSrc }: { logoSrc: string }) {
  return (
    <BlogCoverFrame
      logoSrc={logoSrc}
      caption="Email support, with the whole conversation attached."
      backgroundImage="radial-gradient(ellipse at 12% 90%, #dfd0ee 0%, rgba(223,208,238,0) 64%), radial-gradient(ellipse at 100% 0%, #b9e0e5 0%, rgba(185,224,229,0) 68%), linear-gradient(155deg, #faf4e8, #f6f2f9)"
    >
      <div style={{ position: 'absolute', left: 78, top: 139, width: 1044, display: 'flex', justifyContent: 'center', gap: 16, fontSize: 62, letterSpacing: -2 }}>
        <span>From inbox to</span><span style={{ color: '#168193' }}>answered.</span>
      </div>
      <div style={{ position: 'absolute', left: 78, top: 225, width: 1044, display: 'flex', justifyContent: 'center', fontSize: 23, color: '#496575' }}>Every message. One place to follow through.</div>
      <svg width="286" height="194" viewBox="0 0 286 194" style={{ position: 'absolute', left: 243, top: 323, transform: 'rotate(-7deg)' }}>
        <rect x="8" y="12" width="270" height="170" rx="20" fill="#082e50" />
        <path d="M12 21L133 110Q143 118 153 110L274 21" fill="#dceff0" stroke="#082e50" strokeWidth="4" strokeLinejoin="round" />
        <path d="M16 172L101 98M270 172L185 98" fill="none" stroke="#315e81" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <svg width="138" height="52" viewBox="0 0 138 52" style={{ position: 'absolute', left: 558, top: 388 }}>
        <path d="M5 26H127M115 14L127 26L115 38" fill="none" stroke={coverPalette.teal} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div style={{ position: 'absolute', left: 731, top: 315, display: 'flex', flexDirection: 'column', width: 296, height: 206, padding: 25, borderRadius: 20, background: '#fffffff2', border: '2px solid white', boxShadow: '0 14px 30px #082e500d', transform: 'rotate(5deg)' }}>
        <span style={{ fontSize: 26 }}>Reply ready</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 23 }}>
          <div style={{ width: 238, height: 8, borderRadius: 4, background: '#b9e0e5' }} />
          <div style={{ width: 198, height: 8, borderRadius: 4, background: '#dceff0' }} />
          <div style={{ width: 146, height: 8, borderRadius: 4, background: '#dceff0' }} />
        </div>
        <span style={{ fontSize: 16, color: coverPalette.muted, marginTop: 23 }}>Same conversation.</span>
      </div>
      <div style={{ position: 'absolute', left: 988, top: 297, display: 'flex', justifyContent: 'center', alignItems: 'center', width: 58, height: 58, borderRadius: '50%', background: coverPalette.teal, border: '4px solid #eef7f7' }}>
        <svg width="27" height="27" viewBox="0 0 27 27"><path d="M4 13L10 19L23 6" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
    </BlogCoverFrame>
  )
}

export function DiscourseSupportCover({ logoSrc }: { logoSrc: string }) {
  return (
    <BlogCoverFrame
      logoSrc={logoSrc}
      caption="Bring your knowledge into every new Discourse topic."
      backgroundImage="radial-gradient(ellipse at 84% 24%, #d8c7f2 0%, rgba(216,199,242,0) 70%), radial-gradient(ellipse at 0% 100%, #b9e0e5 0%, rgba(185,224,229,0) 60%), linear-gradient(125deg, #faf4e8, #f3eef9)"
    >
      <div style={{ position: 'absolute', left: 78, top: 217, display: 'flex', flexDirection: 'column', fontSize: 56, lineHeight: 1.12, letterSpacing: -2 }}>
        <span>Old questions.</span>
        <span style={{ color: '#168193' }}>Fresh answers.</span>
      </div>
      <div style={{ position: 'absolute', left: 80, top: 372, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 22, color: '#496575' }}>
        <span>Your knowledge, back</span><span>in the conversation.</span>
      </div>
      <div style={{ position: 'absolute', left: 706, top: 157, width: 332, height: 195, display: 'flex', flexDirection: 'column', padding: 24, gap: 14, borderRadius: 18, background: '#eee5f8', border: '2px solid #ffffffbb', transform: 'rotate(9deg)' }}>
        <span style={{ fontSize: 21, color: '#496575' }}>Setup guide</span>
        <div style={{ height: 7, width: 245, background: '#d2c2e8', borderRadius: 4 }} />
        <div style={{ height: 7, width: 185, background: '#d2c2e8', borderRadius: 4 }} />
      </div>
      <div style={{ position: 'absolute', left: 644, top: 229, width: 332, height: 183, display: 'flex', flexDirection: 'column', padding: 24, gap: 14, borderRadius: 18, background: '#f7f3fc', border: '2px solid white', transform: 'rotate(-7deg)' }}>
        <span style={{ fontSize: 21 }}>Past discussions</span>
        <div style={{ height: 7, width: 243, background: '#dce2e9', borderRadius: 4 }} />
        <div style={{ height: 7, width: 173, background: '#dce2e9', borderRadius: 4 }} />
      </div>
      <div style={{ position: 'absolute', left: 687, top: 342, width: 410, height: 180, display: 'flex', flexDirection: 'column', padding: 25, borderRadius: 20, background: '#fffffff5', border: '2px solid white', boxShadow: '0 16px 36px #082e5012' }}>
        <span style={{ fontSize: 16, color: coverPalette.muted, marginBottom: 12 }}>A new topic in Discourse</span>
        <span style={{ fontSize: 26 }}>How do I set this up?</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 23, paddingTop: 17, borderTop: '1px solid #dce2e9' }}>
          <svg width="21" height="21" viewBox="0 0 24 24"><path d="M4 12L9 17L21 5" fill="none" stroke={coverPalette.teal} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span style={{ color: '#168193', fontSize: 19 }}>Answered from your knowledge</span>
        </div>
      </div>
    </BlogCoverFrame>
  )
}

export function DiscordSupportCover({ logoSrc }: { logoSrc: string }) {
  return (
    <BlogCoverFrame
      logoSrc={logoSrc}
      caption="Support that stays with the conversation."
      backgroundImage="radial-gradient(ellipse at 8% 100%, #f2dfbc 0%, rgba(242,223,188,0) 52%), radial-gradient(ellipse at 100% 20%, #90becb 0%, rgba(144,190,203,0) 75%), linear-gradient(105deg, #eef7f7, #dceff0)"
    >
      <div style={{ position: 'absolute', left: 78, top: 210, display: 'flex', flexDirection: 'column', fontSize: 56, lineHeight: 1.12, letterSpacing: -2 }}>
        <span>Discord questions.</span>
        <span style={{ color: '#168193' }}>Answered</span>
        <span style={{ color: '#168193' }}>in context.</span>
      </div>
      <div style={{ position: 'absolute', left: 80, top: 435, display: 'flex', fontSize: 22, color: '#496575' }}>Text channels + forum threads</div>
      <div style={{ position: 'absolute', left: 748, top: 145, display: 'flex', alignItems: 'center', gap: 15, width: 324, height: 65, paddingLeft: 24, borderRadius: 16, background: '#dceff0', border: '2px solid #ffffffaa', transform: 'rotate(7deg)', color: '#315e81', fontSize: 23 }}>
        <span style={{ fontSize: 30 }}>#</span><span>getting-started</span>
      </div>
      <div style={{ position: 'absolute', left: 642, top: 225, display: 'flex', flexDirection: 'column', width: 460, height: 240, padding: 28, borderRadius: 22, background: '#fffffff2', border: '2px solid white', boxShadow: '0 16px 36px #082e5010' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 26, paddingBottom: 20, borderBottom: '1px solid #dce2e9' }}><span style={{ fontSize: 32, color: coverPalette.teal }}>#</span><span>support</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 22 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#dce2e9' }} />
          <span style={{ fontSize: 22 }}>How do I get started?</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 20 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: coverPalette.aqua }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ width: 272, height: 8, borderRadius: 4, background: '#b9e0e5' }} />
            <div style={{ width: 205, height: 8, borderRadius: 4, background: '#dceff0' }} />
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 600, top: 445, display: 'flex', alignItems: 'center', gap: 16, padding: '20px 26px', borderRadius: 16, background: coverPalette.navy, color: 'white', fontSize: 23, transform: 'rotate(-4deg)', boxShadow: '0 12px 26px #082e5014' }}>
        <svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 12L9 17L21 5" fill="none" stroke="#b9e0e5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span>Reply in the same thread</span>
      </div>
    </BlogCoverFrame>
  )
}

export function CircleSupportCover({ logoSrc }: { logoSrc: string }) {
  return (
    <BlogCoverFrame
      logoSrc={logoSrc}
      caption="Helpful answers, right inside your Circle community."
      backgroundImage="radial-gradient(ellipse at 48% 110%, #8bcbd2 0%, rgba(139,203,210,0) 62%), radial-gradient(ellipse at 88% 0%, #f2dfbc 0%, rgba(242,223,188,0) 72%), linear-gradient(180deg, #faf4e8, #eef7f7)"
    >
      <div style={{ position: 'absolute', left: 78, top: 136, width: 1044, display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: 58, lineHeight: 1.1, letterSpacing: -2 }}>
        <span>More community.</span>
        <span style={{ color: '#168193' }}>Less answering on repeat.</span>
      </div>
      <div style={{ position: 'absolute', left: 230, top: 326, width: 458, height: 110, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingLeft: 28, borderRadius: '22px 22px 22px 4px', background: '#ffffffed', border: '2px solid white', transform: 'rotate(-3deg)', boxShadow: '0 12px 30px #082e5009' }}>
        <span style={{ color: coverPalette.muted, fontSize: 16, marginBottom: 9 }}>A question in Circle</span>
        <span style={{ fontSize: 24 }}>Where do I find the course?</span>
      </div>
      <div style={{ position: 'absolute', left: 512, top: 428, width: 464, height: 112, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingLeft: 28, borderRadius: '22px 22px 4px 22px', background: coverPalette.navy, transform: 'rotate(2deg)', boxShadow: '0 12px 30px #082e5012' }}>
        <span style={{ color: coverPalette.aqua, fontSize: 16, marginBottom: 9 }}>From your knowledge base</span>
        <span style={{ color: 'white', fontSize: 24 }}>Here’s your getting-started guide.</span>
      </div>
      <div style={{ position: 'absolute', left: 939, top: 406, width: 56, height: 56, display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: '50%', background: '#eef7f7', border: '3px solid white' }}>
        <svg width="26" height="26" viewBox="0 0 26 26"><path d="M4 13L10 19L22 6" fill="none" stroke={coverPalette.teal} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
    </BlogCoverFrame>
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
