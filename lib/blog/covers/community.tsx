import { PopFrame, PopCard, PopSticker, pop } from './kit'

const label = { display: 'flex', fontSize: 22, fontWeight: 700, color: pop.muted } as const

function Line({ w, color = pop.line, mt = 12 }: { w: number; color?: string; mt?: number }) {
  return <div style={{ display: 'flex', marginTop: mt, height: 11, width: w, borderRadius: 6, background: color }} />
}

function Arrow({ left, top, rotate = 0, color = pop.white }: { left: number; top: number; rotate?: number; color?: string }) {
  return (
    <div style={{ position: 'absolute', left, top, display: 'flex', transform: `rotate(${rotate}deg)` }}>
      <svg width="70" height="40" viewBox="0 0 70 40">
        <path d="M4 20H50" stroke={color} strokeWidth="9" strokeLinecap="round" fill="none" />
        <path d="M40 5L62 20L40 35" stroke={color} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    </div>
  )
}

/* Circle: two Workflow webhooks feed one reply */
export function CircleSupportCover({ logoSrc }: { logoSrc: string }) {
  const violet = '#7c3aed'
  return (
    <PopFrame
      logoSrc={logoSrc}
      accent={violet}
      glow="#ff6b9d"
      ring={pop.teal}
      tag="CIRCLE"
      headline={[{ text: 'Your members' }, { text: 'ask once', highlight: true }]}
      headlineSize={76}
      chips={['Workflows', 'Spaces', 'Admin token']}
    >
      <PopCard left={680} top={70} width={400} rotate={-4} padding="18px 24px">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', width: 14, height: 14, borderRadius: 7, background: violet, marginRight: 12 }} />
          <div style={label}>Workflow: New post</div>
        </div>
        <div style={{ display: 'flex', marginTop: 12, fontSize: 30, fontWeight: 700, letterSpacing: -1 }}>kind=post</div>
      </PopCard>
      <PopCard left={740} top={200} width={400} rotate={3} padding="18px 24px">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', width: 14, height: 14, borderRadius: 7, background: '#ff6b9d', marginRight: 12 }} />
          <div style={label}>Workflow: New comment</div>
        </div>
        <div style={{ display: 'flex', marginTop: 12, fontSize: 30, fontWeight: 700, letterSpacing: -1 }}>kind=comment</div>
      </PopCard>
      <Arrow left={880} top={318} rotate={90} color={pop.yellow} />
      <PopCard left={690} top={380} width={440} rotate={-2} border={`5px solid ${violet}`} padding="20px 26px">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, color: violet }}>Reply drafted</div>
          <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, background: pop.yellow, borderRadius: 12, padding: '2px 14px' }}>0.8</div>
        </div>
        <Line w={370} mt={14} />
        <Line w={300} mt={10} />
      </PopCard>
      <PopSticker color={pop.teal} textColor={pop.navy} rotate={-8} style={{ position: 'absolute', left: 1020, top: 20 }}>
        SPACES
      </PopSticker>
    </PopFrame>
  )
}

/* Discourse: old topics pile up, the held draft waits for a human */
export function DiscourseSupportCover({ logoSrc }: { logoSrc: string }) {
  const topics = [
    { t: 'Webhook not firing', r: '14', y: '2022' },
    { t: 'Where is the API key?', r: '9', y: '2023' },
    { t: 'Bot cannot post replies', r: '31', y: '2021' },
  ]
  return (
    <PopFrame
      logoSrc={logoSrc}
      accent={pop.yellow}
      glow="#e4572e"
      ring={pop.teal}
      tag="DISCOURSE"
      tagColor={pop.teal}
      highlightText={pop.navy}
      headline={[{ text: 'Same question,' }, { text: 'answered', highlight: true }, { text: 'by the forum' }]}
      headlineSize={72}
      chips={['Categories', 'Bot account', 'Held drafts']}
    >
      <PopCard left={670} top={64} width={470} rotate={2} padding="14px 20px" radius={22}>
        <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: pop.muted, letterSpacing: 2 }}>TOPIC</div>
        {topics.map((x, i) => (
          <div key={x.t} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTop: `3px solid ${pop.line}` }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, letterSpacing: -1 }}>{x.t}</div>
              <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, color: pop.muted }}>{x.y}</div>
            </div>
            <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, color: pop.white, background: i === 1 ? '#e4572e' : pop.navy, borderRadius: 999, padding: '2px 16px' }}>{x.r}</div>
          </div>
        ))}
      </PopCard>
      <PopCard left={700} top={368} width={440} rotate={-3} border="5px solid #e4572e" padding="18px 24px">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', width: 44, height: 44, borderRadius: 22, background: '#e4572e', color: pop.white, fontSize: 26, fontWeight: 700, alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>b</div>
          <div style={{ display: 'flex', fontSize: 24, fontWeight: 700 }}>answerloops-bot</div>
        </div>
        <Line w={360} mt={14} />
        <Line w={250} mt={10} />
        <div style={{ display: 'flex', marginTop: 16 }}>
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: pop.white, background: pop.navy, borderRadius: 12, padding: '6px 16px', marginRight: 10 }}>Approve</div>
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: pop.navy, background: pop.line, borderRadius: 12, padding: '6px 16px' }}>Edit</div>
        </div>
      </PopCard>
      <PopSticker color="#e4572e" rotate={10} style={{ position: 'absolute', left: 1030, top: 498 }}>
        HELD
      </PopSticker>
    </PopFrame>
  )
}

/* GitHub: new issue #341 points back at the closed #340, maintainers are skipped */
export function GitHubSupportCover({ logoSrc }: { logoSrc: string }) {
  const green = '#2da44e'
  const purple = '#8250df'
  return (
    <PopFrame
      logoSrc={logoSrc}
      accent={green}
      glow={purple}
      ring={pop.yellow}
      tag="OPEN SOURCE"
      tagColor={pop.white}
      headline={[{ text: 'Answer it' }, { text: 'once', highlight: true }, { text: 'not twenty' }]}
      headlineSize={72}
      chips={['Issues', 'Discussions', 'Repo docs']}
    >
      <PopCard left={690} top={70} width={430} rotate={-3} padding="20px 26px">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <svg width="34" height="34" viewBox="0 0 34 34" style={{ marginRight: 12 }}>
            <circle cx="17" cy="17" r="13" stroke={green} strokeWidth="5" fill="none" />
            <circle cx="17" cy="17" r="4.5" fill={green} />
          </svg>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, letterSpacing: -1 }}>#341</div>
          <div style={{ display: 'flex', marginLeft: 14, fontSize: 22, fontWeight: 700, color: pop.muted }}>how do I configure X?</div>
        </div>
      </PopCard>
      <Arrow left={860} top={170} rotate={90} color={pop.white} />
      <PopCard left={720} top={250} width={420} rotate={2} padding="20px 26px" border={`5px solid ${purple}`}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <svg width="34" height="34" viewBox="0 0 34 34" style={{ marginRight: 12 }}>
            <circle cx="17" cy="17" r="15" fill={purple} />
            <path d="M10 17.5L15 22.5L24 12" stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, letterSpacing: -1 }}>#340</div>
          <div style={{ display: 'flex', marginLeft: 14, fontSize: 22, fontWeight: 700, color: purple }}>closed</div>
        </div>
        <Line w={330} mt={14} />
      </PopCard>
      <PopCard left={680} top={450} width={450} rotate={-2} padding="14px 22px" radius={20}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: pop.muted }}>author_association</div>
          <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, color: pop.white, background: pop.navy, borderRadius: 10, padding: '2px 14px' }}>OWNER</div>
        </div>
      </PopCard>
      <PopSticker color={pop.yellow} textColor={pop.navy} rotate={9} style={{ position: 'absolute', left: 1010, top: 520 }}>
        SKIPPED
      </PopSticker>
    </PopFrame>
  )
}

/* Email: one message and the headers that keep a thread together */
export function EmailSupportCover({ logoSrc }: { logoSrc: string }) {
  const blue = '#3b6fd8'
  const rows = [
    { k: 'Message-ID', c: pop.navy },
    { k: 'In-Reply-To', c: blue },
    { k: 'References', c: '#e0a800' },
  ]
  return (
    <PopFrame
      logoSrc={logoSrc}
      accent={blue}
      glow={pop.yellow}
      ring={pop.orange}
      tag="EMAIL"
      headline={[{ text: 'One inbox,' }, { text: 'one thread', highlight: true }]}
      headlineSize={80}
      chips={['Inbound MX', 'DKIM', 'Threading']}
    >
      <PopCard left={680} top={70} width={450} rotate={-3} padding="20px 26px">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <svg width="52" height="40" viewBox="0 0 52 40" style={{ marginRight: 14 }}>
            <rect x="2" y="2" width="48" height="36" rx="7" fill={blue} />
            <path d="M6 8L26 24L46 8" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, color: pop.muted }}>support@yourcompany.com</div>
        </div>
        <div style={{ display: 'flex', marginTop: 14, fontSize: 32, fontWeight: 700, letterSpacing: -1 }}>Where is my invoice?</div>
        <Line w={380} mt={14} />
        <Line w={300} mt={10} />
      </PopCard>
      <PopCard left={730} top={310} width={410} rotate={3} padding="14px 22px" radius={22}>
        {rows.map((r, i) => (
          <div key={r.k} style={{ display: 'flex', alignItems: 'center', marginTop: i === 0 ? 0 : 10 }}>
            <div style={{ display: 'flex', width: 16, height: 16, borderRadius: 8, background: r.c, marginRight: 14 }} />
            <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, letterSpacing: -1 }}>{r.k}</div>
          </div>
        ))}
      </PopCard>
      <PopSticker color={pop.orange} rotate={-9} style={{ position: 'absolute', left: 690, top: 492 }}>
        SAME TICKET
      </PopSticker>
      <PopSticker color={pop.yellow} textColor={pop.navy} rotate={7} style={{ position: 'absolute', left: 960, top: 500 }}>
        NO DUPLICATES
      </PopSticker>
    </PopFrame>
  )
}
