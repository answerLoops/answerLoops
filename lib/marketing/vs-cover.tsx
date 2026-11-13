import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { marketingSiteEnabled } from '@/lib/site'

// Social card for the /vs comparison pages. Each page used to inherit the one
// generic site card, so every shared comparison looked identical in a feed.
// Same 1200 × 630 canvas and navy/teal palette as the blog covers, with louder
// accents (orange, yellow, cyan) so a shared link stands out.
export const VS_COVER_SIZE = { width: 1200, height: 630 }

const palette = {
  navy: '#082e50',
  deep: '#061f38',
  teal: '#19c3d6',
  orange: '#ff6b3d',
  yellow: '#ffd23f',
}

interface VsCoverProps {
  logoSrc: string
  competitor: string
  /** Up to three things the page actually compares, shown as chips. */
  compares: string[]
}

/** Long names ("Khoros Aurora AI") shrink so the line never overflows. */
function headlineSize(name: string): number {
  if (name.length > 15) return 80
  if (name.length > 11) return 92
  return 108
}

export function VsCover({ logoSrc, competitor, compares }: VsCoverProps) {
  const size = headlineSize(competitor)
  return (
    <div
      style={{
        ...VS_COVER_SIZE,
        position: 'relative',
        display: 'flex',
        overflow: 'hidden',
        fontFamily: 'Geist',
        color: '#ffffff',
        backgroundColor: palette.deep,
        backgroundImage: `radial-gradient(ellipse at 96% 4%, ${palette.orange} 0%, rgba(255,107,61,0) 46%), radial-gradient(ellipse at 74% 112%, ${palette.teal} 0%, rgba(25,195,214,0) 52%), radial-gradient(ellipse at 0% 100%, #1f5f9a 0%, rgba(31,95,154,0) 46%), linear-gradient(135deg, ${palette.navy} 0%, ${palette.deep} 100%)`,
      }}
    >
      {/* Decorative pops */}
      <div style={{ position: 'absolute', right: -70, bottom: -80, width: 250, height: 250, borderRadius: 125, border: `22px solid ${palette.yellow}`, display: 'flex' }} />
      <div style={{ position: 'absolute', left: 640, top: 46, width: 0, height: 0, borderLeft: '22px solid transparent', borderRight: '22px solid transparent', borderBottom: `38px solid ${palette.teal}`, transform: 'rotate(18deg)', display: 'flex' }} />

      {/* Brand */}
      <div style={{ position: 'absolute', top: 44, left: 72, display: 'flex', alignItems: 'center', fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>
        {/* Image generation requires a plain image with explicit dimensions. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: 18, background: '#ffffff', marginRight: 14 }}>
          <img src={logoSrc} alt="" width={46} height={46} />
        </div>
        <span>answer</span>
        <span style={{ color: palette.teal }}>Loops</span>
      </div>

      {/* Tag */}
      <div
        style={{
          position: 'absolute',
          top: 150,
          left: 72,
          display: 'flex',
          background: palette.yellow,
          color: palette.navy,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 3,
          padding: '9px 20px',
          borderRadius: 999,
          transform: 'rotate(-2deg)',
        }}
      >
        COMPARISON
      </div>

      {/* Headline */}
      <div style={{ position: 'absolute', left: 72, top: 214, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: 96, fontWeight: 700, letterSpacing: -4, lineHeight: 1 }}>
          answerLoops vs
        </div>
        <div style={{ display: 'flex', marginTop: 16 }}>
          <div
            style={{
              display: 'flex',
              background: palette.orange,
              borderRadius: 22,
              padding: '4px 30px 14px 30px',
              fontSize: size,
              fontWeight: 700,
              letterSpacing: -4,
              lineHeight: 1,
              transform: 'rotate(-1.6deg)',
              boxShadow: '0 10px 0 rgba(6,31,56,0.3)',
            }}
          >
            {competitor}
          </div>
        </div>
      </div>

      {/* Face-off cards */}
      <div style={{ position: 'absolute', left: 770, top: 128, width: 330, display: 'flex', alignItems: 'center', background: '#ffffff', color: palette.navy, borderRadius: 26, padding: '22px 26px', border: `5px solid ${palette.teal}`, fontSize: 36, fontWeight: 700, letterSpacing: -1, transform: 'rotate(-4deg)', boxShadow: '0 14px 0 rgba(6,31,56,0.3)' }}>
        <div style={{ display: 'flex', width: 46, height: 46, borderRadius: 23, background: palette.teal, alignItems: 'center', justifyContent: 'center', marginRight: 16 }}>
          <svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" fill="none" stroke="#ffffff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <span>answerLoops</span>
      </div>
      <div style={{ position: 'absolute', left: 840, top: 392, width: 300, display: 'flex', alignItems: 'center', background: '#ffffff', color: palette.navy, borderRadius: 26, padding: '22px 26px', fontSize: 34, fontWeight: 700, letterSpacing: -1, transform: 'rotate(3deg)', boxShadow: '0 14px 0 rgba(6,31,56,0.3)' }}>
        <div style={{ display: 'flex', width: 46, height: 46, borderRadius: 23, background: '#dce2e9', marginRight: 16 }} />
        <span>{competitor.length > 11 ? competitor.split(' ')[0] : competitor}</span>
      </div>
      <div style={{ position: 'absolute', left: 876, top: 268, width: 118, height: 118, borderRadius: 59, background: palette.yellow, color: palette.navy, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 50, fontWeight: 700, letterSpacing: -2, transform: 'rotate(-8deg)', boxShadow: '0 9px 0 rgba(6,31,56,0.3)' }}>
        VS
      </div>

      {/* What is compared */}
      <div style={{ position: 'absolute', left: 72, bottom: 54, display: 'flex' }}>
        {compares.slice(0, 3).map((label, i) => (
          <div
            key={label}
            style={{
              display: 'flex',
              marginRight: 16,
              fontSize: 28,
              fontWeight: 700,
              padding: '12px 24px',
              borderRadius: 16,
              color: i === 0 ? '#062a44' : i === 1 ? '#ffffff' : palette.navy,
              background: i === 0 ? palette.teal : i === 1 ? 'rgba(255,255,255,0.08)' : '#ffffff',
              border: i === 1 ? '3px solid rgba(255,255,255,0.9)' : `3px solid ${i === 0 ? palette.teal : '#ffffff'}`,
            }}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Shared renderer for each /vs/<slug>/opengraph-image.tsx. A self-hosted
 * install does not serve the comparison pages (they 404), so the card
 * 404s with them rather than advertising our marketing from someone else's
 * domain.
 */
export async function renderVsCover(competitor: string, compares: string[]) {
  if (!marketingSiteEnabled()) return new Response('Not found', { status: 404 })
  const [logo, geistBold] = await Promise.all([
    readFile(join(process.cwd(), 'public/icon.png')),
    // The image renderer only ships a regular weight, so the heavy headline
    // needs a real bold file. Geist is the site's own typeface (OFL; licence
    // sits beside the font).
    readFile(join(process.cwd(), 'lib/marketing/fonts/Geist-Bold.ttf')),
  ])
  return new ImageResponse(
    <VsCover
      logoSrc={`data:image/png;base64,${logo.toString('base64')}`}
      competitor={competitor}
      compares={compares}
    />,
    {
      ...VS_COVER_SIZE,
      fonts: [{ name: 'Geist', data: geistBold, weight: 700, style: 'normal' }],
    },
  )
}
