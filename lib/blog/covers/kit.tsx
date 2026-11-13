import type { CSSProperties, ReactNode } from 'react'

// Shared pieces for the blog cover art. The 1200 x 630 canvas, the navy base,
// the logo lockup, the tag, the big headline and the chips live here, so every
// cover looks like one family. Each cover supplies its own accent colour, its
// own words, and one signature visual built from what its article is about.
//
// Rendered by next/og (Satori): flexbox only (no grid), every element with more
// than one child needs `display: 'flex'`, and the only font is Geist Bold.

export const COVER_SIZE = { width: 1200, height: 630 }

export const pop = {
  deep: '#061f38',
  navy: '#082e50',
  teal: '#19c3d6',
  orange: '#ff6b3d',
  yellow: '#ffd23f',
  ink: '#082e50',
  muted: '#5d6b7c',
  line: '#dce2e9',
  white: '#ffffff',
}

export interface HeadlinePart {
  text: string
  /** Draw this line on a tilted block of the accent colour. At most one per cover. */
  highlight?: boolean
}

interface PopFrameProps {
  logoSrc: string
  /** The dominant bright colour of this cover (top-right glow, headline block, ring). */
  accent?: string
  /** The second glow, bottom of the cover. */
  glow?: string
  /** Colour of the small ring in the bottom-right corner. */
  ring?: string
  tag: string
  tagColor?: string
  /** One to three lines. Exactly one may be highlighted. */
  headline: HeadlinePart[]
  /** Headline size in px. 80 fits three short lines; use 68 to 72 for longer words. */
  headlineSize?: number
  /** Up to three short labels shown bottom-left. */
  chips?: string[]
  /** Text on the highlighted block. Defaults to white; use navy on a light accent. */
  highlightText?: string
  /** The signature visual. Position it absolutely inside x 640..1150, y 60..570. */
  children?: ReactNode
}

const chipStyle = (i: number): CSSProperties => ({
  display: 'flex',
  marginRight: 14,
  fontSize: 26,
  fontWeight: 700,
  padding: '11px 22px',
  borderRadius: 15,
  color: i === 0 ? '#062a44' : i === 1 ? pop.white : pop.navy,
  background: i === 0 ? pop.teal : i === 1 ? 'rgba(255,255,255,0.08)' : pop.white,
  border: i === 1 ? '3px solid rgba(255,255,255,0.9)' : `3px solid ${i === 0 ? pop.teal : pop.white}`,
})

export function PopFrame({
  logoSrc,
  accent = pop.orange,
  glow = pop.teal,
  ring = pop.yellow,
  tag,
  tagColor = pop.yellow,
  headline,
  headlineSize = 80,
  chips = [],
  highlightText = pop.white,
  children,
}: PopFrameProps) {
  return (
    <div
      style={{
        ...COVER_SIZE,
        position: 'relative',
        display: 'flex',
        overflow: 'hidden',
        fontFamily: 'Geist',
        color: pop.white,
        backgroundColor: pop.deep,
        backgroundImage: `radial-gradient(ellipse at 96% 4%, ${accent} 0%, rgba(0,0,0,0) 46%), radial-gradient(ellipse at 74% 112%, ${glow} 0%, rgba(0,0,0,0) 52%), radial-gradient(ellipse at 0% 100%, #1f5f9a 0%, rgba(31,95,154,0) 46%), linear-gradient(135deg, ${pop.navy} 0%, ${pop.deep} 100%)`,
      }}
    >
      <div style={{ position: 'absolute', right: -70, bottom: -80, width: 250, height: 250, borderRadius: 125, border: `22px solid ${ring}`, display: 'flex' }} />

      {/* Logo lockup */}
      <div style={{ position: 'absolute', top: 44, left: 72, display: 'flex', alignItems: 'center', fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: 18, background: pop.white, marginRight: 14 }}>
          {/* Image generation requires a plain image with explicit dimensions. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} alt="" width={46} height={46} />
        </div>
        <span>answer</span>
        <span style={{ color: pop.teal }}>Loops</span>
      </div>

      {/* Tag */}
      <div style={{ position: 'absolute', top: 150, left: 72, display: 'flex', background: tagColor, color: pop.navy, fontSize: 22, fontWeight: 700, letterSpacing: 3, padding: '9px 20px', borderRadius: 999, transform: 'rotate(-2deg)' }}>
        {tag}
      </div>

      {/* Headline */}
      <div style={{ position: 'absolute', left: 72, top: 212, display: 'flex', flexDirection: 'column', fontSize: headlineSize, fontWeight: 700, letterSpacing: -4, lineHeight: 1 }}>
        {headline.map((part, i) => (
          <div key={i} style={{ display: 'flex', marginTop: i === 0 ? 0 : 12 }}>
            {part.highlight ? (
              <div style={{ display: 'flex', background: accent, color: highlightText, borderRadius: 22, padding: '4px 26px 12px 26px', lineHeight: 1, transform: 'rotate(-1.6deg)', boxShadow: '0 10px 0 rgba(6,31,56,0.3)' }}>
                {part.text}
              </div>
            ) : (
              part.text
            )}
          </div>
        ))}
      </div>

      {/* Chips */}
      {chips.length > 0 && (
        <div style={{ position: 'absolute', left: 72, bottom: 50, display: 'flex' }}>
          {chips.slice(0, 3).map((label, i) => (
            <div key={label} style={chipStyle(i)}>
              {label}
            </div>
          ))}
        </div>
      )}

      {children}
    </div>
  )
}

/** A white card with the shared shadow, for the signature visual. Position with left/top. */
export function PopCard({
  left,
  top,
  width,
  rotate = 0,
  border,
  padding = '22px 26px',
  radius = 26,
  children,
}: {
  left: number
  top: number
  width: number
  rotate?: number
  border?: string
  padding?: string
  radius?: number
  children?: ReactNode
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width,
        display: 'flex',
        flexDirection: 'column',
        background: pop.white,
        color: pop.ink,
        borderRadius: radius,
        padding,
        ...(border ? { border } : {}),
        transform: `rotate(${rotate}deg)`,
        boxShadow: '0 16px 0 rgba(6,31,56,0.28)',
      }}
    >
      {children}
    </div>
  )
}

/** A small rounded sticker, e.g. "SIGNED" or "DRAFT". */
export function PopSticker({ children, color = pop.orange, textColor = pop.white, rotate = 8, style }: { children: ReactNode; color?: string; textColor?: string; rotate?: number; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', background: color, color: textColor, fontSize: 20, fontWeight: 700, letterSpacing: 1, padding: '8px 16px', borderRadius: 999, transform: `rotate(${rotate}deg)`, boxShadow: '0 6px 0 rgba(6,31,56,0.3)', ...style }}>
      {children}
    </div>
  )
}
