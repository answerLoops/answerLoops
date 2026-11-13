
export * from './covers/chat'
export * from './covers/community'
export * from './covers/platform'

// All covers share the public site's palette and a 1200 × 630 canvas.
export const BLOG_COVER_SIZE = { width: 1200, height: 630 }
const coverPalette = {
  navy: '#082e50',
  teal: '#168fa3',
  aqua: '#b9e0e5',
  paleAqua: '#eef7f7',
  sand: '#faf4e8',
  muted: '#5d6b7c',
}

// Louder palette for the developer-guide covers. Needs the bold Geist weight
// (see the `fonts` option where the route renders it): the image renderer only
// ships a regular weight, which flattens a headline like this.
const popPalette = { deep: '#061f38', teal: '#19c3d6', orange: '#ff6b3d', yellow: '#ffd23f' }

export function DiscourseApiCover({ logoSrc }: { logoSrc: string }) {
  return (
    <div
      style={{
        ...BLOG_COVER_SIZE,
        position: 'relative',
        display: 'flex',
        overflow: 'hidden',
        fontFamily: 'Geist',
        color: '#ffffff',
        backgroundColor: popPalette.deep,
        backgroundImage: `radial-gradient(ellipse at 96% 4%, ${popPalette.orange} 0%, rgba(255,107,61,0) 46%), radial-gradient(ellipse at 74% 112%, ${popPalette.teal} 0%, rgba(25,195,214,0) 52%), radial-gradient(ellipse at 0% 100%, #1f5f9a 0%, rgba(31,95,154,0) 46%), linear-gradient(135deg, ${coverPalette.navy} 0%, ${popPalette.deep} 100%)`,
      }}
    >
      <div style={{ position: 'absolute', right: -70, bottom: -80, width: 250, height: 250, borderRadius: 125, border: `22px solid ${popPalette.yellow}`, display: 'flex' }} />
      <div style={{ position: 'absolute', left: 520, top: 46, width: 0, height: 0, borderLeft: '20px solid transparent', borderRight: '20px solid transparent', borderBottom: `34px solid ${popPalette.teal}`, transform: 'rotate(18deg)', display: 'flex' }} />

      {/* Brand */}
      <div style={{ position: 'absolute', top: 44, left: 72, display: 'flex', alignItems: 'center', fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: 18, background: '#ffffff', marginRight: 14 }}>
          {/* Image generation requires a plain image with explicit dimensions. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} alt="" width={46} height={46} />
        </div>
        <span>answer</span>
        <span style={{ color: popPalette.teal }}>Loops</span>
      </div>

      {/* Tag */}
      <div style={{ position: 'absolute', top: 150, left: 72, display: 'flex', background: popPalette.yellow, color: coverPalette.navy, fontSize: 22, fontWeight: 700, letterSpacing: 3, padding: '9px 20px', borderRadius: 999, transform: 'rotate(-2deg)' }}>
        DEVELOPER GUIDE
      </div>

      {/* Headline */}
      <div style={{ position: 'absolute', left: 72, top: 206, display: 'flex', flexDirection: 'column', fontSize: 80, fontWeight: 700, letterSpacing: -4, lineHeight: 1 }}>
        <div style={{ display: 'flex' }}>Build a</div>
        <div style={{ display: 'flex', marginTop: 12 }}>
          <div style={{ display: 'flex', background: popPalette.orange, borderRadius: 22, padding: '4px 26px 12px 26px', lineHeight: 1, transform: 'rotate(-1.6deg)', boxShadow: '0 10px 0 rgba(6,31,56,0.3)' }}>
            Discourse
          </div>
        </div>
        <div style={{ display: 'flex', marginTop: 14 }}>answer bot</div>
      </div>

      {/* Chips */}
      <div style={{ position: 'absolute', left: 72, bottom: 50, display: 'flex' }}>
        <div style={{ display: 'flex', marginRight: 14, fontSize: 26, fontWeight: 700, padding: '11px 22px', borderRadius: 15, color: '#062a44', background: popPalette.teal, border: `3px solid ${popPalette.teal}` }}>API keys</div>
        <div style={{ display: 'flex', marginRight: 14, fontSize: 26, fontWeight: 700, padding: '11px 22px', borderRadius: 15, color: '#ffffff', background: 'rgba(255,255,255,0.08)', border: '3px solid rgba(255,255,255,0.9)' }}>Webhooks</div>
        <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, padding: '11px 22px', borderRadius: 15, color: coverPalette.navy, background: '#ffffff', border: '3px solid #ffffff' }}>Rate limits</div>
      </div>

      {/* Topic card */}
      <div style={{ position: 'absolute', left: 690, top: 62, width: 430, display: 'flex', flexDirection: 'column', background: '#ffffff', color: coverPalette.navy, borderRadius: 26, padding: '24px 28px', transform: 'rotate(-3deg)', boxShadow: '0 16px 0 rgba(6,31,56,0.28)' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', width: 46, height: 46, borderRadius: 23, background: '#e4572e', alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
            <svg width="26" height="26" viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 0-9.8 12.1L2 22l7.8-1.7A10 10 0 1 0 12 2Z" fill="#ffffff" /><path d="M8 7h4.3a4.2 4.2 0 1 1 0 8.4H8V7Zm2.1 1.9v4.6h2.2a2.3 2.3 0 1 0 0-4.6h-2.2Z" fill="#e4572e" /></svg>
          </div>
          <div style={{ display: 'flex', fontSize: 20, color: coverPalette.muted, fontWeight: 700 }}>New topic in #support</div>
        </div>
        <div style={{ display: 'flex', marginTop: 16, fontSize: 28, fontWeight: 700, letterSpacing: -1 }}>How do I verify a webhook?</div>
        <div style={{ display: 'flex', marginTop: 14, height: 9, width: 330, borderRadius: 5, background: '#dce2e9' }} />
      </div>

      {/* Signature pill + arrow */}
      <div style={{ position: 'absolute', left: 800, top: 262, display: 'flex', alignItems: 'center', background: popPalette.yellow, color: coverPalette.navy, borderRadius: 16, padding: '12px 20px', fontSize: 24, fontWeight: 700, transform: 'rotate(2deg)', boxShadow: '0 9px 0 rgba(6,31,56,0.3)' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#082e50" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 10 }}><rect x="4" y="10" width="16" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
        sha256=9f2c…
      </div>
      <svg style={{ position: 'absolute', left: 860, top: 322 }} width="56" height="70" viewBox="0 0 44 56" fill="none"><path d="M22 4 C 38 16, 6 30, 22 48" stroke="#19c3d6" strokeWidth="7" strokeLinecap="round" /><path d="M9 38 L22 50 L35 37" stroke="#19c3d6" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" /></svg>

      {/* Reply card */}
      <div style={{ position: 'absolute', left: 660, top: 388, width: 450, display: 'flex', flexDirection: 'column', background: '#ffffff', color: coverPalette.navy, borderRadius: 26, padding: '20px 26px', border: `5px solid ${popPalette.teal}`, transform: 'rotate(2.2deg)', boxShadow: '0 16px 0 rgba(6,31,56,0.28)' }}>
        <div style={{ position: 'absolute', right: -16, top: -22, display: 'flex', background: popPalette.orange, color: '#ffffff', fontSize: 20, fontWeight: 700, padding: '8px 16px', borderRadius: 999, transform: 'rotate(8deg)', letterSpacing: 1 }}>SIGNED</div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', width: 46, height: 46, borderRadius: 14, background: coverPalette.navy, alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#19c3d6" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3" /><rect x="4" y="6" width="16" height="13" rx="4" /><circle cx="9.5" cy="12" r="1.2" fill="#19c3d6" /><circle cx="14.5" cy="12" r="1.2" fill="#19c3d6" /></svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 22, fontWeight: 700 }}>answerloops-bot</div>
            <div style={{ display: 'flex', fontSize: 16, fontWeight: 700, color: '#0f8a99' }}>Checked against your docs</div>
          </div>
        </div>
        <div style={{ display: 'flex', marginTop: 12, fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>Hash the raw body, then compare in constant time.</div>
      </div>
    </div>
  )
}

// Real download sizes for 4-bit builds, in GB, from Docker's model registry.
const MODEL_SIZES = [
  { label: '3B', gb: 2.0 },
  { label: '7B', gb: 4.4 },
  { label: '14B', gb: 9.1 },
  { label: '70B', gb: 42.5 },
]
const LAPTOP_GB = 16
const BAR_PX_PER_GB = 4.9
const LABEL_COL = 60
const BAR_AREA = 212

export function LocalModelCover({ logoSrc }: { logoSrc: string }) {
  return (
    <div
      style={{
        ...BLOG_COVER_SIZE,
        position: 'relative',
        display: 'flex',
        overflow: 'hidden',
        fontFamily: 'Geist',
        color: '#ffffff',
        backgroundColor: popPalette.deep,
        backgroundImage: `radial-gradient(ellipse at 96% 4%, ${popPalette.orange} 0%, rgba(255,107,61,0) 46%), radial-gradient(ellipse at 74% 112%, ${popPalette.teal} 0%, rgba(25,195,214,0) 52%), radial-gradient(ellipse at 0% 100%, #1f5f9a 0%, rgba(31,95,154,0) 46%), linear-gradient(135deg, ${coverPalette.navy} 0%, ${popPalette.deep} 100%)`,
      }}
    >
      <div style={{ position: 'absolute', right: -70, bottom: -80, width: 250, height: 250, borderRadius: 125, border: `22px solid ${popPalette.yellow}`, display: 'flex' }} />

      <div style={{ position: 'absolute', top: 44, left: 72, display: 'flex', alignItems: 'center', fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: 18, background: '#ffffff', marginRight: 14 }}>
          {/* Image generation requires a plain image with explicit dimensions. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} alt="" width={46} height={46} />
        </div>
        <span>answer</span>
        <span style={{ color: popPalette.teal }}>Loops</span>
      </div>

      <div style={{ position: 'absolute', top: 150, left: 72, display: 'flex', background: popPalette.yellow, color: coverPalette.navy, fontSize: 22, fontWeight: 700, letterSpacing: 3, padding: '9px 20px', borderRadius: 999, transform: 'rotate(-2deg)' }}>
        OPEN SOURCE EXPERIMENT
      </div>

      <div style={{ position: 'absolute', left: 72, top: 212, display: 'flex', flexDirection: 'column', fontSize: 80, fontWeight: 700, letterSpacing: -4, lineHeight: 1 }}>
        <div style={{ display: 'flex' }}>Support bot,</div>
        <div style={{ display: 'flex', marginTop: 12 }}>
          <div style={{ display: 'flex', background: popPalette.orange, borderRadius: 22, padding: '4px 26px 12px 26px', lineHeight: 1, transform: 'rotate(-1.6deg)', boxShadow: '0 10px 0 rgba(6,31,56,0.3)' }}>
            on a laptop
          </div>
        </div>
      </div>

      <div style={{ position: 'absolute', left: 72, bottom: 50, display: 'flex' }}>
        <div style={{ display: 'flex', marginRight: 14, fontSize: 26, fontWeight: 700, padding: '11px 22px', borderRadius: 15, color: '#062a44', background: popPalette.teal, border: `3px solid ${popPalette.teal}` }}>Local model</div>
        <div style={{ display: 'flex', marginRight: 14, fontSize: 26, fontWeight: 700, padding: '11px 22px', borderRadius: 15, color: '#ffffff', background: 'rgba(255,255,255,0.08)', border: '3px solid rgba(255,255,255,0.9)' }}>Real forum</div>
        <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, padding: '11px 22px', borderRadius: 15, color: coverPalette.navy, background: '#ffffff', border: '3px solid #ffffff' }}>AGPL-3.0</div>
      </div>

      {/* Model sizes against a 16 GB laptop */}
      <div style={{ position: 'absolute', left: 700, top: 96, width: 430, display: 'flex', flexDirection: 'column', background: '#ffffff', color: coverPalette.navy, borderRadius: 26, padding: '26px 28px 30px', transform: 'rotate(-2deg)', boxShadow: '0 16px 0 rgba(6,31,56,0.28)' }}>
        <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: coverPalette.muted, marginBottom: 20 }}>Model size on disk</div>
        <div style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {MODEL_SIZES.map((m) => {
            const over = m.gb > LAPTOP_GB
            return (
              <div key={m.label} style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
                <div style={{ display: 'flex', width: LABEL_COL, fontSize: 24, fontWeight: 700 }}>{m.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', width: BAR_AREA }}>
                  <div style={{ display: 'flex', width: Math.max(8, Math.round(m.gb * BAR_PX_PER_GB)), height: 30, borderRadius: 8, background: over ? popPalette.orange : popPalette.teal }} />
                </div>
                <div style={{ display: 'flex', width: 100, justifyContent: 'flex-end', whiteSpace: 'nowrap', fontSize: 22, fontWeight: 700, color: over ? '#c2410c' : '#0f8a99' }}>{m.gb.toFixed(1)} GB</div>
              </div>
            )
          })}
          {/* the 16 GB line */}
          <div style={{ position: 'absolute', top: -6, bottom: 6, left: LABEL_COL + Math.round(LAPTOP_GB * BAR_PX_PER_GB), width: 0, borderLeft: `4px dashed ${coverPalette.navy}`, display: 'flex' }} />
        </div>
        <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, color: coverPalette.navy, marginTop: 2 }}>Dashed line: a 16 GB laptop</div>
      </div>
    </div>
  )
}
