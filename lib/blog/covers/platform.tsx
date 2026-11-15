import type { CSSProperties, ReactNode } from 'react'
import { PopFrame, PopCard, PopSticker, pop } from './kit'

const abs = (left: number, top: number, extra: CSSProperties = {}): CSSProperties => ({
  position: 'absolute',
  left,
  top,
  display: 'flex',
  ...extra,
})

function Check({ size = 30, color = '#16a34a' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M4 12.5 L9.5 18 L20 6.5" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Cross({ size = 30, color = '#e11d48' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M5 5 L19 19 M19 5 L5 19" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

function Dots() {
  return (
    <div style={{ display: 'flex' }}>
      {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
        <div key={c} style={{ display: 'flex', width: 16, height: 16, borderRadius: 8, background: c, marginRight: 8 }} />
      ))}
    </div>
  )
}

// MCP: the five real tools, one of them writes.
export function McpSupportCover({ logoSrc }: { logoSrc: string }) {
  const tools: { name: string; write?: boolean }[] = [
    { name: 'search_kb' },
    { name: 'get_faq' },
    { name: 'get_tickets' },
    { name: 'create_ticket', write: true },
    { name: 'generate_answer' },
  ]
  return (
    <PopFrame
      logoSrc={logoSrc}
      accent={pop.teal}
      glow="#7c3aed"
      ring={pop.orange}
      tag="MCP SERVER"
      tagColor={pop.teal}
      headline={[{ text: 'Agents can' }, { text: 'reach in', highlight: true }]}
      highlightText={pop.navy}
    >
      <div
        style={abs(660, 66, {
          width: 480,
          flexDirection: 'column',
          background: '#0a1424',
          borderRadius: 26,
          border: '3px solid #2b4a6f',
          padding: '16px 26px 18px 26px',
          transform: 'rotate(-2deg)',
          boxShadow: '0 16px 0 rgba(6,31,56,0.45)',
        })}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <Dots />
          <div style={{ display: 'flex', fontSize: 22, color: '#8fb3d9' }}>POST /api/mcp</div>
        </div>
        {tools.map((t) => (
          <div
            key={t.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 8,
              padding: '6px 16px',
              borderRadius: 14,
              fontSize: 30,
              background: t.write ? pop.orange : 'rgba(255,255,255,0.07)',
              color: t.write ? pop.white : pop.teal,
            }}
          >
            <div style={{ display: 'flex' }}>{t.name}</div>
            {t.write && <div style={{ display: 'flex', fontSize: 20, letterSpacing: 2 }}>WRITES</div>}
          </div>
        ))}
      </div>
      <PopCard left={720} top={462} width={400} rotate={2} padding="12px 24px">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 24, color: pop.muted }}>confidence</div>
          <div style={{ display: 'flex', fontSize: 46, color: '#0e9aa8' }}>0.86</div>
        </div>
      </PopCard>
    </PopFrame>
  )
}

// Notion: share a page with the connection, then publish it.
export function NotionKnowledgeCover({ logoSrc }: { logoSrc: string }) {
  const rows: { label: string; on: boolean }[] = [
    { label: 'Setup guide', on: true },
    { label: 'Runbooks', on: true },
    { label: 'Notes to self', on: false },
  ]
  return (
    <PopFrame
      logoSrc={logoSrc}
      accent={pop.yellow}
      glow={pop.orange}
      ring={pop.teal}
      tag="NOTION SYNC"
      mark="notion-knowledge-base-sync"
      headline={[{ text: 'Share a page,' }, { text: 'ship the answer', highlight: true }]}
      headlineSize={66}
      highlightText={pop.navy}
    >
      <PopCard left={660} top={80} width={470} rotate={-2} border="3px solid #111" padding="22px 28px 26px 28px">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 8, border: '3px solid #111', fontSize: 28, marginRight: 14 }}>N</div>
          <div style={{ display: 'flex', fontSize: 34, color: '#111' }}>Connections</div>
        </div>
        <div style={{ display: 'flex', height: 3, background: '#e5e5e5', margin: '16px 0 4px 0' }} />
        {rows.map((r) => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
            <div style={{ display: 'flex', fontSize: 30, color: r.on ? '#111' : '#9a9a9a' }}>{r.label}</div>
            <div
              style={{
                display: 'flex',
                width: 76,
                height: 40,
                borderRadius: 20,
                background: r.on ? '#16a34a' : '#d4d4d4',
                alignItems: 'center',
                justifyContent: r.on ? 'flex-end' : 'flex-start',
                padding: 4,
              }}
            >
              <div style={{ display: 'flex', width: 32, height: 32, borderRadius: 16, background: pop.white }} />
            </div>
          </div>
        ))}
      </PopCard>
      <PopCard left={740} top={420} width={400} rotate={3} padding="16px 24px">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 28 }}>Setup guide</div>
          <PopSticker color="#9a9a9a" rotate={0} style={{ boxShadow: 'none' }}>DRAFT</PopSticker>
        </div>
        <div style={{ display: 'flex', fontSize: 22, color: pop.muted, marginTop: 8 }}>Searchable until you publish</div>
      </PopCard>
    </PopFrame>
  )
}

// Dual agent: the reviewer catches the claim the sources never made.
export function DualAgentReviewCover({ logoSrc }: { logoSrc: string }) {
  return (
    <PopFrame
      logoSrc={logoSrc}
      accent="#f43f8e"
      glow={pop.yellow}
      ring={pop.teal}
      tag="DUAL-AGENT REVIEW"
      headline={[{ text: 'One AI agent' }, { text: 'drafts.' }, { text: 'One AI agent' }, { text: 'reviews.', highlight: true }]}
      headlineSize={62}
    >
      <PopCard left={660} top={70} width={470} rotate={-2} padding="18px 26px 22px 26px">
        <div style={{ display: 'flex', fontSize: 22, letterSpacing: 2, color: pop.muted }}>DRAFTER</div>
        <div style={{ display: 'flex', fontSize: 31, lineHeight: 1.15, marginTop: 8 }}>Downgrade anytime for a prorated refund.</div>
      </PopCard>
      <PopCard left={700} top={262} width={450} rotate={2} border="4px solid #f43f8e" padding="18px 26px 22px 26px">
        <div style={{ display: 'flex', fontSize: 22, letterSpacing: 2, color: '#f43f8e' }}>REVIEWER</div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 12 }}>
          <Check size={34} />
          <div style={{ display: 'flex', fontSize: 28, marginLeft: 12 }}>Downgrade anytime</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 10 }}>
          <Cross size={34} />
          <div style={{ display: 'flex', fontSize: 28, marginLeft: 12, color: '#e11d48' }}>Prorated: not in sources</div>
        </div>
      </PopCard>
      <div style={abs(682, 482, { alignItems: 'center' })}>
        <div style={{ display: 'flex', fontSize: 84, color: pop.yellow, letterSpacing: -3 }}>0.62</div>
        <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 20 }}>
          <div style={{ display: 'flex', fontSize: 26, color: pop.white }}>below 0.8</div>
          <PopSticker color={pop.yellow} textColor={pop.navy} rotate={-4} style={{ marginTop: 6, fontSize: 24 }}>HELD FOR REVIEW</PopSticker>
        </div>
      </div>
    </PopFrame>
  )
}

function ThreadLine({ w, color }: { w: number; color: string }) {
  return <div style={{ display: 'flex', width: w, height: 12, borderRadius: 6, background: color, marginTop: 10 }} />
}

// Support answers: a thread reply gets promoted and found by search.
export function SupportAnswersKnowledgeCover({ logoSrc }: { logoSrc: string }) {
  return (
    <PopFrame
      logoSrc={logoSrc}
      accent="#10b981"
      glow="#5865f2"
      ring={pop.yellow}
      tag="KNOWLEDGE BASE"
      tagColor={pop.teal}
      headline={[{ text: 'Answer it' }, { text: 'once', highlight: true }, { text: 'keep it' }]}
      headlineSize={72}
      highlightText={pop.navy}
    >
      <PopCard left={650} top={72} width={400} rotate={-3} padding="18px 24px 22px 24px">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', width: 36, height: 36, borderRadius: 18, background: '#5865f2', marginRight: 12 }} />
          <div style={{ display: 'flex', fontSize: 24, color: pop.muted }}>#help thread</div>
        </div>
        <div style={{ display: 'flex', fontSize: 30, marginTop: 12 }}>Fixed by setting the callback URL</div>
        <ThreadLine w={300} color={pop.line} />
        <ThreadLine w={200} color={pop.line} />
      </PopCard>
      <PopSticker color={pop.orange} rotate={-6} style={{ position: 'absolute', left: 990, top: 205, fontSize: 26 }}>PROMOTE</PopSticker>
      <PopCard left={720} top={278} width={410} rotate={2} border="4px solid #10b981" padding="18px 24px 22px 24px">
        <div style={{ display: 'flex', fontSize: 22, letterSpacing: 2, color: '#0f9b6d' }}>KB ARTICLE</div>
        <div style={{ display: 'flex', fontSize: 32, marginTop: 8 }}>Set the callback URL</div>
        <ThreadLine w={320} color="#bfeedd" />
        <ThreadLine w={240} color="#bfeedd" />
      </PopCard>
      <div
        style={abs(660, 472, {
          width: 470,
          alignItems: 'center',
          background: pop.white,
          color: pop.ink,
          borderRadius: 999,
          padding: '14px 26px',
          boxShadow: '0 12px 0 rgba(6,31,56,0.28)',
        })}
      >
        <svg width={30} height={30} viewBox="0 0 24 24">
          <circle cx="10" cy="10" r="6.5" fill="none" stroke={pop.navy} strokeWidth="3.5" />
          <path d="M15 15 L21 21" stroke={pop.navy} strokeWidth="3.5" strokeLinecap="round" />
        </svg>
        <div style={{ display: 'flex', fontSize: 28, marginLeft: 14, flexGrow: 1 }}>callback url error</div>
        <Check size={32} />
      </div>
    </PopFrame>
  )
}

const channels: { name: string; color: string }[] = [
  { name: 'Discord', color: '#5865f2' },
  { name: 'Slack', color: '#4a154b' },
  { name: 'Discourse', color: '#e4572e' },
  { name: 'Circle', color: '#7c3aed' },
  { name: 'GitHub', color: '#24292f' },
  { name: 'Telegram', color: '#229ed9' },
  { name: 'Email', color: '#64748b' },
  { name: 'Google Chat', color: '#34a853' },
]

// Multiplatform: every channel lands in one inbox.
export function MultiplatformSupportCover({ logoSrc }: { logoSrc: string }) {
  const cell = (c: { name: string; color: string }, i: number): ReactNode => (
    <div
      key={c.name}
      style={{
        display: 'flex',
        alignItems: 'center',
        width: 228,
        marginRight: i % 2 === 0 ? 16 : 0,
        marginBottom: 14,
        background: c.color,
        border: '3px solid rgba(255,255,255,0.85)',
        borderRadius: 18,
        padding: '10px 16px',
        fontSize: 26,
        color: pop.white,
        transform: `rotate(${i % 2 === 0 ? -2 : 2}deg)`,
        boxShadow: '0 6px 0 rgba(6,31,56,0.3)',
      }}
    >
      <div style={{ display: 'flex', width: 16, height: 16, borderRadius: 8, background: pop.white, marginRight: 12 }} />
      {c.name}
    </div>
  )
  return (
    <PopFrame
      logoSrc={logoSrc}
      accent={pop.orange}
      glow="#7c3aed"
      ring={pop.teal}
      tag="MULTI-CHANNEL"
      headline={[{ text: 'Every channel,' }, { text: 'one inbox', highlight: true }]}
      headlineSize={72}
    >
      <div style={abs(655, 70, { width: 490, flexWrap: 'wrap' })}>{channels.map(cell)}</div>
      <PopCard left={680} top={392} width={450} rotate={-1.5} border={`4px solid ${pop.orange}`} padding="16px 26px 20px 26px">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 34 }}>Ticket queue</div>
          <div style={{ display: 'flex', fontSize: 22, color: pop.muted }}>threshold 0.8</div>
        </div>
        <div style={{ display: 'flex', fontSize: 24, color: pop.muted, marginTop: 6 }}>One knowledge base behind it</div>
      </PopCard>
    </PopFrame>
  )
}
