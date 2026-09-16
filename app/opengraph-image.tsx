/* oxlint-disable next/no-img-element -- ImageResponse uses native image elements to render embedded assets into a PNG. */
import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const alt =
  'answerLoops — Faster answers. More time to build. Your docs become answers for your community and agents, with skills and MCP.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OpengraphImage() {
  const logo = await readFile(join(process.cwd(), 'public/answerloops-brand-logo.png'))
  const logoSrc = `data:image/png;base64,${logo.toString('base64')}`
  return new ImageResponse(
    (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(120deg, #ffffff 55%, #eff6ff 100%)',
          padding: '52px 64px',
          color: '#171717',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            position: 'relative',
            justifyContent: 'flex-end',
            height: 120,
            flexShrink: 0,
            alignItems: 'flex-start',
          }}
        >
          <img
            src={logoSrc}
            alt="answerLoops"
            width={205}
            height={205}
            style={{ position: 'absolute', top: -32, left: -22 }}
          />
          <div style={{ display: 'flex', color: '#535353', fontSize: 20 }}>
            answerloops.com
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1, gap: 32 }}>
          <div style={{ display: 'flex', flexDirection: 'column', width: 650 }}>
            <div style={{ display: 'flex', color: '#1d4ed8', fontSize: 17, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 22 }}>
              AGENT-NATIVE AI SUPPORT
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', fontSize: 64, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.045em' }}>
              <span>Faster answers.</span>
              <span style={{ color: '#2563eb' }}>More time to build.</span>
            </div>
            <div style={{ display: 'flex', marginTop: 24, fontSize: 25, color: '#535353', lineHeight: 1.4, maxWidth: 550 }}>
              Turn your docs into answers for your community.
            </div>
          </div>
          <div style={{ display: 'flex', position: 'relative', top: -16, width: 360, height: 330, flexShrink: 0 }}>
            <svg width="360" height="330" viewBox="0 0 360 330" style={{ position: 'absolute', top: 0, left: 0 }}>
              <path d="M180 65V113M180 193V217H84V250M180 217H276V250" fill="none" stroke="#93c5fd" strokeWidth="2" />
              <path d="m175 105 5 8 5-8M79 242l5 8 5-8M271 242l5 8 5-8" fill="none" stroke="#2563eb" strokeWidth="2" />
              <circle cx="180" cy="217" r="4" fill="#2563eb" />
            </svg>
            <div style={{ display: 'flex', position: 'absolute', top: 5, left: 80, width: 200, height: 60, alignItems: 'center', justifyContent: 'center', gap: 12, background: '#fff', border: '1px solid #d4d4d4', borderRadius: 12 }}>
              <svg width="24" height="26" viewBox="0 0 24 26">
                <path d="M5 2h9l5 5v17H5Z" fill="#eff6ff" stroke="#2563eb" strokeWidth="1.5" />
                <path d="M14 2v6h5M9 13h6M9 17h6" fill="none" stroke="#2563eb" strokeWidth="1.5" />
              </svg>
              <span style={{ fontSize: 21 }}>Your docs</span>
            </div>
            <div style={{ display: 'flex', position: 'absolute', top: 113, left: 50, width: 260, height: 80, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 16, boxShadow: '0 8px 24px rgba(37, 99, 235, 0.08)' }}>
              <span style={{ fontSize: 25, fontWeight: 700, color: '#1d4ed8' }}>Grounded answers</span>
              <span style={{ fontSize: 16, color: '#535353' }}>Powered by your knowledge</span>
            </div>
            <div style={{ display: 'flex', position: 'absolute', top: 250, left: 5, width: 158, height: 74, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#fff', border: '1px solid #d4d4d4', borderRadius: 12 }}>
              <span style={{ fontSize: 21 }}>Community</span>
              <span style={{ fontSize: 15, color: '#535353' }}>Chat · forums · email</span>
            </div>
            <div style={{ display: 'flex', position: 'absolute', top: 250, left: 197, width: 158, height: 74, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#fff', border: '1px solid #d4d4d4', borderRadius: 12 }}>
              <span style={{ fontSize: 21 }}>Your agent</span>
              <span style={{ fontSize: 15, color: '#535353' }}>MCP · REST API</span>
            </div>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid #dedede',
            paddingTop: 24,
          }}
        >
          <div style={{ display: 'flex', gap: 12 }}>
            {['Agent skills', 'MCP server', 'Self-hostable'].map((label) => (
              <div
                key={label}
                style={{ display: 'flex', border: '1px solid #bfdbfe', borderRadius: 8, background: '#eff6ff', color: '#1d4ed8', padding: '10px 16px', fontSize: 18 }}
              >
                {label}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', fontSize: 20, color: '#535353' }}>
            Built for your community and your agents.
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
