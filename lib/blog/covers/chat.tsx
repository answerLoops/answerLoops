import { PopFrame, PopCard, PopSticker, pop } from './kit'

// Covers for the chat-platform articles (Discord, Slack, Telegram, Google Chat).

const abs = { position: 'absolute' as const, display: 'flex' as const }

function Avatar({ color, size = 48, label }: { color: string; size?: number; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: size / 2, background: color, color: pop.white, fontSize: size * 0.5, fontWeight: 700, flexShrink: 0 }}>
      {label}
    </div>
  )
}

export function DiscordSupportCover({ logoSrc }: { logoSrc: string }) {
  const blurple = '#5865f2'
  return (
    <PopFrame
      logoSrc={logoSrc}
      accent={blurple}
      glow={pop.teal}
      ring={pop.yellow}
      tag="DISCORD"
      mark="discord-community-support"
      headline={[{ text: 'Forum posts' }, { text: 'become tickets', highlight: true }]}
      headlineSize={72}
    >
      {/* forum post */}
      <PopCard left={660} top={90} width={470} rotate={-2} padding="20px 24px">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: pop.white, background: blurple, padding: '4px 14px', borderRadius: 10 }}>support-forum</div>
          <div style={{ display: 'flex', fontSize: 22, color: pop.muted, fontWeight: 700, marginLeft: 12 }}>new post</div>
        </div>
        <div style={{ display: 'flex', fontSize: 34, fontWeight: 700, letterSpacing: -1, lineHeight: 1.1 }}>How do I set up SSO?</div>
        <div style={{ display: 'flex', marginTop: 14 }}>
          <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, color: blurple, background: '#e8eaff', padding: '5px 12px', borderRadius: 999 }}>ThreadCreate</div>
          <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, color: pop.navy, background: pop.yellow, padding: '5px 12px', borderRadius: 999, marginLeft: 10 }}>Ticket #214</div>
        </div>
      </PopCard>

      {/* thread replies */}
      <div style={{ ...abs, left: 720, top: 322, width: 4, height: 150, background: 'rgba(255,255,255,0.55)', borderRadius: 2 }} />
      <div style={{ ...abs, left: 740, top: 300, width: 400, flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.14)', border: '3px solid rgba(255,255,255,0.5)', borderRadius: 22, padding: '14px 18px' }}>
          <Avatar color={pop.orange} label="M" />
          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 14 }}>
            <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: pop.yellow }}>maya</div>
            <div style={{ display: 'flex', fontSize: 24, fontWeight: 700 }}>Same, stuck on step 3</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', background: pop.white, color: pop.ink, borderRadius: 22, padding: '16px 18px', marginTop: 20, marginLeft: 30, boxShadow: '0 12px 0 rgba(6,31,56,0.3)', transform: 'rotate(1.5deg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 54, height: 54, borderRadius: 27, background: pop.teal, flexShrink: 0 }}>
            <svg width="30" height="30" viewBox="0 0 30 30">
              <path d="M5 15a10 10 0 1 1 20 0 10 10 0 0 1-20 0z" fill="none" stroke={pop.navy} strokeWidth="3" />
              <path d="M10 15h10M15 10v10" stroke={pop.navy} strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ display: 'flex', fontSize: 22, fontWeight: 700 }}>answerLoops</div>
              <div style={{ display: 'flex', fontSize: 16, fontWeight: 700, color: pop.white, background: blurple, borderRadius: 6, padding: '2px 8px', marginLeft: 10 }}>BOT</div>
            </div>
            <div style={{ display: 'flex', fontSize: 24, fontWeight: 700 }}>Answered in-thread</div>
          </div>
        </div>
      </div>
      <PopSticker color={pop.orange} rotate={-7} style={{ left: 990, top: 30, position: 'absolute', fontSize: 24 }}>DRAFT FIRST</PopSticker>
    </PopFrame>
  )
}

export function SlackSupportCover({ logoSrc }: { logoSrc: string }) {
  const aubergine = '#4a154b'
  const sky = '#36c5f0'
  return (
    <PopFrame
      logoSrc={logoSrc}
      accent="#7b2d8e"
      glow={sky}
      ring={pop.yellow}
      tag="SLACK"
      mark="slack-no-admin-approval"
      headline={[{ text: 'Skip the' }, { text: 'admin queue', highlight: true }]}
      headlineSize={80}
    >
      {/* door one: OAuth, waiting */}
      <PopCard left={650} top={80} width={480} rotate={-2} padding="18px 24px">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 700 }}>OAuth install</div>
          <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, background: '#f2e6f4', color: aubergine, padding: '5px 14px', borderRadius: 999 }}>needs an admin</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 14 }}>
          <svg width="44" height="44" viewBox="0 0 44 44">
            <rect x="8" y="19" width="28" height="21" rx="5" fill={aubergine} />
            <path d="M14 19v-5a8 8 0 0 1 16 0v5" fill="none" stroke={aubergine} strokeWidth="5" />
          </svg>
          <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, color: pop.muted, marginLeft: 14 }}>Review pending...</div>
        </div>
      </PopCard>

      {/* door two: polling, open */}
      <PopCard left={690} top={270} width={470} rotate={2} border={`6px solid ${sky}`} padding="18px 24px">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 700 }}>Polling mode</div>
          <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, background: sky, color: pop.navy, padding: '5px 14px', borderRadius: 999 }}>no admin</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', background: '#eef2f6', borderRadius: 12, padding: '8px 14px' }}>
            <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: pop.muted, width: 130 }}>Bot token</div>
            <div style={{ display: 'flex', fontSize: 24, fontWeight: 700 }}>xoxb-...</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', background: '#eef2f6', borderRadius: 12, padding: '8px 14px', marginTop: 10 }}>
            <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: pop.muted, width: 130 }}>Channels</div>
            <div style={{ display: 'flex', fontSize: 24, fontWeight: 700 }}>C04..., C07...</div>
          </div>
        </div>
      </PopCard>

      {/* poll interval */}
      <div style={{ ...abs, left: 715, top: 500, alignItems: 'center', background: pop.yellow, color: pop.navy, borderRadius: 999, padding: '10px 24px', fontSize: 26, fontWeight: 700, boxShadow: '0 8px 0 rgba(6,31,56,0.3)', transform: 'rotate(-3deg)' }}>
        polls every 60s
      </div>
      <PopSticker color={pop.orange} rotate={7} style={{ left: 990, top: 505, position: 'absolute', fontSize: 24 }}>LIVE TODAY</PopSticker>
    </PopFrame>
  )
}

export function TelegramSupportCover({ logoSrc }: { logoSrc: string }) {
  const blue = '#229ed9'
  return (
    <PopFrame
      logoSrc={logoSrc}
      accent={blue}
      glow={pop.orange}
      ring={pop.yellow}
      tag="TELEGRAM"
      mark="telegram-community-support"
      headline={[{ text: 'A group chat' }, { text: 'that never sleeps', highlight: true }]}
      headlineSize={70}
    >
      {/* fast chat */}
      <div style={{ ...abs, left: 660, top: 70, width: 400, flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignSelf: 'flex-start', background: 'rgba(255,255,255,0.16)', border: '3px solid rgba(255,255,255,0.5)', borderRadius: 22, padding: '10px 18px', fontSize: 24, fontWeight: 700 }}>anyone know how to log in?</div>
        <div style={{ display: 'flex', alignSelf: 'flex-start', marginTop: 12, marginLeft: 30, background: 'rgba(255,255,255,0.16)', border: '3px solid rgba(255,255,255,0.5)', borderRadius: 22, padding: '10px 18px', fontSize: 24, fontWeight: 700 }}>2am here, same question</div>
      </div>

      {/* bot reply */}
      <PopCard left={720} top={210} width={420} rotate={-2} border={`6px solid ${blue}`} padding="16px 22px">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <svg width="40" height="40" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="20" fill={blue} />
            <path d="M8 19l23-9-4 20-7-5-4 4v-6l10-9-13 7z" fill="#fff" />
          </svg>
          <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, marginLeft: 12, color: blue }}>your_support_bot</div>
        </div>
        <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, marginTop: 10, lineHeight: 1.15 }}>Tap Sign in with SSO on the login page.</div>
      </PopCard>

      {/* privacy mode switch */}
      <PopCard left={700} top={385} width={430} rotate={1.5} padding="16px 22px" radius={24}>
        <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: pop.muted }}>@BotFather</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 30, fontWeight: 700 }}>/setprivacy</div>
            <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, color: pop.orange }}>Privacy mode: off</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', width: 96, height: 52, borderRadius: 26, background: '#2fbf71', padding: 5, justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', width: 42, height: 42, borderRadius: 21, background: pop.white }} />
          </div>
        </div>
      </PopCard>
      <PopSticker color={pop.yellow} textColor={pop.navy} rotate={9} style={{ left: 1000, top: 30, position: 'absolute', fontSize: 24 }}>START HERE</PopSticker>
    </PopFrame>
  )
}

export function GoogleChatSupportCover({ logoSrc }: { logoSrc: string }) {
  const green = '#34a853'
  return (
    <PopFrame
      logoSrc={logoSrc}
      accent={green}
      glow={pop.yellow}
      ring={pop.orange}
      tag="GOOGLE CHAT"
      mark="google-chat-internal-support"
      headline={[{ text: 'Pair a space' }, { text: 'with one code', highlight: true }]}
      headlineSize={72}
    >
      {/* code card */}
      <PopCard left={660} top={85} width={470} rotate={-2} padding="18px 24px">
        <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: pop.muted }}>Settings / Integrations / Google Chat</div>
        <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, marginTop: 6 }}>Your connect code</div>
        <div style={{ display: 'flex', marginTop: 10, background: '#e6f4ea', border: `3px dashed ${green}`, borderRadius: 14, padding: '10px 16px', fontSize: 34, fontWeight: 700, color: '#176b34' }}>gc_7f3a9c1e04b2...</div>
      </PopCard>

      {/* the message in the space */}
      <div style={{ ...abs, left: 700, top: 300, width: 440, alignItems: 'center', background: 'rgba(255,255,255,0.14)', border: '3px solid rgba(255,255,255,0.55)', borderRadius: 22, padding: '14px 20px' }}>
        <div style={{ display: 'flex', fontSize: 28, fontWeight: 700 }}>/connect gc_7f3a...</div>
      </div>

      {/* confirmation */}
      <div style={{ ...abs, left: 745, top: 392, width: 395, alignItems: 'center', background: pop.white, color: pop.ink, borderRadius: 22, padding: '16px 20px', boxShadow: '0 12px 0 rgba(6,31,56,0.3)', transform: 'rotate(1.5deg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 26, background: green, flexShrink: 0 }}>
          <svg width="30" height="30" viewBox="0 0 30 30">
            <path d="M6 16l6 6 12-13" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 14 }}>
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: pop.muted }}>answerLoops app</div>
          <div style={{ display: 'flex', fontSize: 28, fontWeight: 700 }}>Space connected</div>
        </div>
      </div>
      <PopSticker color={pop.yellow} textColor={pop.navy} rotate={-6} style={{ left: 740, top: 520, position: 'absolute', fontSize: 24 }}>1 SPACE PER ORG</PopSticker>
    </PopFrame>
  )
}
