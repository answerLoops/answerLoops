/**
 * Seeds a LOCAL database with a believable, entirely fictional demo workspace
 * ("Northwind Robotics", a hobbyist-robotics SDK community) so documentation
 * screenshots can be captured from the real app without any customer data.
 *
 * Usage (see scripts/docs-demo/README.md):
 *   DATABASE_URL=postgres://community:community@localhost:5545/community pnpm docs:seed
 *
 * Safety:
 *   - Refuses to run unless DATABASE_URL (and DIRECT_DATABASE_URL, when set)
 *     point at a local database. See guard.ts.
 *   - Only ever touches the one workspace it owns, identified by DEMO_ORG_SLUG,
 *     and the demo users it created (provider = DEMO_PROVIDER). Nothing is
 *     truncated, and the users keep their ids across runs.
 *   - Idempotent: every run wipes that workspace's data and writes it again.
 *   - Contains no secret values. Credentials that the app needs to display a
 *     "connected" integration are generated at runtime with crypto.randomBytes
 *     and are meaningless outside the throwaway database.
 */

import crypto from 'node:crypto'
import { assertLocalDatabaseUrl } from './guard'
import { DEMO_ORG_SLUG, DEMO_OWNER_EMAIL, DEMO_PROVIDER } from './constants'
import { KB_ARTICLES, KB_SOURCE_META, type KbSourceKey } from './content-kb'
import { ANSWERED_TOPICS, GAP_TOPICS, ISSUE_TOPICS } from './content-tickets'

const DEMO_ORG_NAME = 'Northwind Robotics'
const EMBEDDING_MODEL = 'text-embedding-3-small'
const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000

// ---------------------------------------------------------------------------
// Small deterministic helpers. Content is deterministic; only timestamps move
// with the clock, so two runs on the same day produce the same workspace.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rng = mulberry32(20261024)
const rand = (min: number, max: number) => min + rng() * (max - min)
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1))
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rng() * items.length)]
const chance = (p: number) => rng() < p
const iso = (ms: number) => new Date(ms).toISOString()
const hex = (bytes: number) => crypto.randomBytes(bytes).toString('hex')

function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function weightedPick<T>(items: Array<[T, number]>): T {
  const total = items.reduce((sum, [, w]) => sum + w, 0)
  let r = rng() * total
  for (const [item, w] of items) {
    r -= w
    if (r <= 0) return item
  }
  return items[items.length - 1][0]
}

function fakeSnowflake(ms: number): string {
  // 18-digit decimal id that looks like a chat-platform message id.
  return String(BigInt(ms - 1420070400000) * BigInt(4194304) + BigInt(randInt(0, 4194303)))
}

/** A unit-length pseudo-random vector, so cosine similarity behaves. */
function randomUnitVector(dim: number): number[] {
  const v = Array.from({ length: dim }, () => rng() * 2 - 1)
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  return v.map((x) => Math.round((x / norm) * 1e5) / 1e5)
}

// ---------------------------------------------------------------------------
// Fictional people and places
// ---------------------------------------------------------------------------

const STAFF = [
  { name: 'Priya Raman', email: DEMO_OWNER_EMAIL, role: 'owner' },
  { name: 'Marcus Webb', email: 'marcus.webb@example.com', role: 'admin' },
  { name: 'Elena Rossi', email: 'elena.rossi@example.com', role: 'member' },
  { name: 'Tomasz Nowak', email: 'tomasz.nowak@example.com', role: 'member' },
] as const

const HANDLES = [
  'gearhead42', 'ember_fox', 'solder_sam', 'bytebot', 'mira.builds', 'kestrel_dev', 'nanotorque', 'pixelpilot',
  'robo_rhys', 'tinker_tess', 'axle_andy', 'lowbattery', 'quietservo', 'dana_k', 'lidarlover', 'wiregoblin',
  'oscar_makes', 'neo_navigator', 'pwm_pete', 'coil_carla', 'breadboard_bea', 'jules_in_motion', 'hexapod_hal', 'cobalt_cam',
]

const EMAIL_PEOPLE = [
  ['Sam Okafor', 'sam.okafor'], ['Lena Fischer', 'lena.fischer'], ['Arjun Mehta', 'arjun.mehta'], ['Chloe Martin', 'chloe.martin'],
  ['Diego Alvarez', 'diego.alvarez'], ['Hana Kobayashi', 'hana.kobayashi'], ['Owen Price', 'owen.price'], ['Grace Liu', 'grace.liu'],
] as const

const DISCORD_GUILD_ID = '1190000000000000001'
const DISCORD_CHANNELS = ['1190000000000000011', '1190000000000000012', '1190000000000000013']
const SLACK_TEAM_ID = 'T0DEMO0001'
const SLACK_CHANNELS = ['C0DEMO0001', 'C0DEMO0002']
const DISCOURSE_SITE = 'https://forum.example.org'
const CIRCLE_SITE = 'https://community.example.org'

// ---------------------------------------------------------------------------
// Ticket planning
// ---------------------------------------------------------------------------

type Platform = 'discord' | 'slack' | 'discourse' | 'email' | 'telegram' | 'circle'
type Priority = 'critical' | 'high' | 'medium' | 'low'
type Status = 'open' | 'in_progress' | 'resolved' | 'closed'

const SLA_HOURS: Record<Priority, { response: number; resolve: number }> = {
  critical: { response: 1, resolve: 4 },
  high: { response: 4, resolve: 24 },
  medium: { response: 24, resolve: 72 },
  low: { response: 72, resolve: 168 },
}

interface PlannedTicket {
  kind: 'answered' | 'issue' | 'gap'
  topicIndex: number
  ts: number
  platform: Platform
  number: number
}

interface BuiltTicket {
  planned: PlannedTicket
  content: string
  category: string
  summary: string
  priority: Priority
  status: Status
  draft: string | null
  draftStatus: 'pending' | 'needs_human' | 'posted' | 'approved' | 'overridden'
  skipReason: string | null
  draftPostedAt: string | null
  resolutionNotes: string | null
  firstResponseAt: number | null
  resolvedAt: number | null
  slaResponseMet: 0 | 1 | null
  slaResolveMet: 0 | 1 | null
  confidence: number | null
  deflected: boolean
  severity: number
  cluster: string | null
  replies: Array<{ staffName: string; content: string; at: number }>
  events: Array<{ type: string; oldValue: string | null; newValue: string | null; actor: string; at: number }>
  source: {
    messageId: string
    guildId: string | null
    channelId: string | null
    threadId: string | null
    authorId: string
    authorName: string
    url: string | null
  }
}

function planTimestamps(total: number, now: number): number[] {
  const todayStart = Math.floor(now / DAY) * DAY
  const weights: number[] = []
  for (let i = 0; i < 30; i++) {
    const dayStart = todayStart - (29 - i) * DAY
    const dow = new Date(dayStart).getUTCDay()
    const weekend = dow === 0 || dow === 6
    // Community volume grows gently over the month, dips on weekends and has a
    // little day-to-day wobble so the chart does not look machine-made.
    weights.push((weekend ? 0.35 : 1) * (0.8 + (0.5 * i) / 29) * (0.85 + 0.3 * rng()))
  }
  const sum = weights.reduce((a, b) => a + b, 0)
  const exact = weights.map((w) => (w / sum) * total)
  const counts = exact.map(Math.floor)
  let remaining = total - counts.reduce((a, b) => a + b, 0)
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (remaining <= 0) break
    counts[i]++
    remaining--
  }

  const stamps: number[] = []
  for (let i = 0; i < 30; i++) {
    const dayStart = todayStart - (29 - i) * DAY
    for (let n = 0; n < counts[i]; n++) {
      const hour = 7 + ((rng() + rng() + rng()) / 3) * 14
      let ts = dayStart + hour * HOUR + randInt(0, 59) * MINUTE
      if (ts > now - 25 * MINUTE) ts = dayStart + rand(0, Math.max(1, now - 25 * MINUTE - dayStart))
      stamps.push(Math.floor(ts))
    }
  }
  return stamps.sort((a, b) => a - b)
}

function sourceFor(platform: Platform, ts: number, authorIndex: number, summary: string): BuiltTicket['source'] {
  const handle = HANDLES[authorIndex % HANDLES.length]
  const person = EMAIL_PEOPLE[authorIndex % EMAIL_PEOPLE.length]
  const slug = summary.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  switch (platform) {
    case 'discord':
      return {
        messageId: fakeSnowflake(ts),
        guildId: DISCORD_GUILD_ID,
        channelId: pick(DISCORD_CHANNELS),
        threadId: null,
        authorId: fakeSnowflake(ts - 90 * DAY - authorIndex * 1000),
        authorName: handle,
        url: null,
      }
    case 'slack': {
      const secs = Math.floor(ts / 1000)
      const msgTs = `${secs}.${String(randInt(100000, 999999))}`
      const channel = pick(SLACK_CHANNELS)
      return {
        messageId: msgTs,
        guildId: null,
        channelId: channel,
        threadId: msgTs,
        authorId: `U0DEMO${String(authorIndex).padStart(4, '0')}`,
        authorName: handle,
        url: `https://northwind-demo.example.org/archives/${channel}/p${msgTs.replace('.', '')}`,
      }
    }
    case 'discourse': {
      const topic = 400 + Math.floor((ts - (Date.now() - 30 * DAY)) / HOUR / 2) + randInt(0, 1)
      return {
        messageId: `post-${topic}-1`,
        guildId: null,
        channelId: '7',
        threadId: String(topic),
        authorId: String(100 + authorIndex),
        authorName: handle,
        url: `${DISCOURSE_SITE}/t/${slug}/${topic}`,
      }
    }
    case 'circle': {
      const post = 9000 + randInt(0, 800) + Math.floor((ts % DAY) / MINUTE)
      return {
        messageId: `circle-${post}`,
        guildId: null,
        channelId: 'help',
        threadId: String(post),
        authorId: String(500 + authorIndex),
        authorName: handle,
        url: `${CIRCLE_SITE}/c/help/${slug}`,
      }
    }
    case 'email':
      return {
        messageId: `<${hex(8)}@mail.example.com>`,
        guildId: null,
        channelId: 'support@example.com',
        threadId: null,
        authorId: `${person[1]}@example.com`,
        authorName: person[0],
        url: null,
      }
    case 'telegram':
      return {
        messageId: String(randInt(3000, 90000)),
        guildId: null,
        channelId: '-1009000000001',
        threadId: null,
        authorId: String(7000000 + authorIndex * 13),
        authorName: handle,
        url: null,
      }
  }
}

function buildTickets(now: number): BuiltTicket[] {
  const total = ANSWERED_TOPICS.length + ISSUE_TOPICS.length + GAP_TOPICS.length
  const stamps = planTimestamps(total, now)
  const start = now - 30 * DAY

  // Knowledge-gap tickets only exist in the last 20 days, so the open backlog
  // looks current rather than neglected.
  const recentIdx = stamps.map((t, i) => [t, i] as const).filter(([t]) => t >= now - 20 * DAY).map(([, i]) => i)
  const gapSlots = new Set(shuffle(recentIdx).slice(0, GAP_TOPICS.length))
  const otherKinds: Array<['answered' | 'issue', number]> = shuffle([
    ...ANSWERED_TOPICS.map((_, i) => ['answered', i] as ['answered', number]),
    ...ISSUE_TOPICS.map((_, i) => ['issue', i] as ['issue', number]),
  ])

  const planned: PlannedTicket[] = []
  const gapOrder = shuffle(GAP_TOPICS.map((_, i) => i))
  let gi = 0
  let oi = 0
  for (let i = 0; i < stamps.length; i++) {
    const platform = weightedPick<Platform>([
      ['discord', 36], ['slack', 20], ['discourse', 16], ['email', 14], ['telegram', 8], ['circle', 6],
    ])
    if (gapSlots.has(i)) {
      planned.push({ kind: 'gap', topicIndex: gapOrder[gi++], ts: stamps[i], platform, number: 0 })
    } else {
      const [kind, topicIndex] = otherKinds[oi++]
      planned.push({ kind, topicIndex, ts: stamps[i], platform, number: 0 })
    }
  }
  planned.forEach((p, i) => (p.number = i + 1))

  const built: BuiltTicket[] = []
  const usedMessageIds = new Set<string>()
  let staffRotation = 0
  const nextStaff = () => STAFF[staffRotation++ % STAFF.length].name

  for (const p of planned) {
    const authorIndex = randInt(0, 200)
    const age = now - p.ts
    const progress = (p.ts - start) / (now - start)
    let b: BuiltTicket

    if (p.kind === 'answered') {
      const topic = ANSWERED_TOPICS[p.topicIndex]
      // The deflection rate improves over the month as gaps are filled.
      const deflectProbability = age < 18 * HOUR ? 0.5 : Math.min(0.93, 0.58 + 0.42 * progress)
      const deflected = chance(deflectProbability)
      const priority: Priority = chance(0.7) ? 'low' : 'medium'
      const base: BuiltTicket = emptyTicket(p, topic.question, topic.category, topic.summary, priority, authorIndex)
      base.severity = Math.round(rand(0.05, 0.3) * 100) / 100
      if (deflected) {
        const confidence = Math.round(rand(0.82, 0.97) * 100) / 100
        const fr = p.ts + randInt(1, 4) * MINUTE
        base.confidence = confidence
        base.deflected = true
        base.draft = topic.answer
        base.draftStatus = 'posted'
        base.draftPostedAt = iso(fr)
        base.status = 'resolved'
        base.firstResponseAt = fr
        base.resolvedAt = fr + randInt(3, 90) * MINUTE
        base.resolutionNotes = topic.answer
        base.events.push({ type: 'ai_draft_posted', oldValue: null, newValue: 'posted', actor: 'system', at: fr })
        base.events.push({ type: 'status_changed', oldValue: 'open', newValue: 'resolved', actor: 'system', at: base.resolvedAt })
        if (chance(0.18)) {
          base.replies.push({ staffName: 'Customer', content: pick(['That fixed it, thank you!', 'Worked, thanks.', 'Perfect, exactly what I needed.', 'Got it running. Thanks!']), at: base.resolvedAt + randInt(5, 60) * MINUTE })
          base.events.push({ type: 'customer_reply', oldValue: null, newValue: null, actor: 'customer', at: base.replies[0].at })
        }
      } else {
        const confidence = Math.round(rand(0.62, 0.86) * 100) / 100
        base.confidence = confidence
        base.draft = topic.answer
        base.draftStatus = 'needs_human'
        const processed = age > 20 * HOUR && (age > 3 * DAY || chance(0.9))
        if (processed) {
          const staff = nextStaff()
          const approve = chance(0.62)
          const fr = p.ts + randInt(12, 20 * 60) * MINUTE
          base.draftStatus = approve ? 'approved' : 'overridden'
          base.draftPostedAt = iso(fr)
          const reply = approve ? topic.answer : `Thanks for asking. ${topic.answer} Let me know if that does not sort it out.`
          base.replies.push({ staffName: staff, content: reply, at: fr })
          base.events.push({ type: 'replied', oldValue: null, newValue: reply.slice(0, 100), actor: staff, at: fr })
          base.events.push({ type: 'status_changed', oldValue: 'open', newValue: 'in_progress', actor: staff, at: fr })
          base.firstResponseAt = fr
          base.status = chance(0.85) ? 'resolved' : 'closed'
          base.resolvedAt = fr + randInt(5, 240) * MINUTE
          base.resolutionNotes = reply
          base.events.push({ type: 'status_changed', oldValue: 'in_progress', newValue: base.status, actor: staff, at: base.resolvedAt })
          if (chance(0.22)) {
            const at = base.resolvedAt + randInt(10, 120) * MINUTE
            base.replies.push({ staffName: 'Customer', content: pick(['Thanks, that did it.', 'Great, working now. Appreciate the quick reply.', 'Solved! Thank you.']), at })
            base.events.push({ type: 'customer_reply', oldValue: null, newValue: null, actor: 'customer', at })
          }
        } else {
          base.status = chance(0.25) ? 'in_progress' : 'open'
        }
      }
      b = base
    } else if (p.kind === 'issue') {
      const topic = ISSUE_TOPICS[p.topicIndex]
      b = emptyTicket(p, topic.question, topic.category, topic.summary, topic.priority, authorIndex)
      b.draftStatus = 'needs_human'
      b.skipReason = 'bug_or_feature'
      b.severity = topic.category === 'bug' ? Math.round(rand(0.45, 0.9) * 100) / 100 : Math.round(rand(0.1, 0.35) * 100) / 100
      const staff = nextStaff()
      const sla = SLA_HOURS[topic.priority]
      if (topic.resolution && age > 3 * DAY) {
        const fr = p.ts + randInt(20, Math.max(25, sla.response * 50)) * MINUTE
        b.firstResponseAt = fr
        b.status = chance(0.8) ? 'resolved' : 'closed'
        b.resolvedAt = fr + randInt(2, 60) * HOUR
        b.resolutionNotes = topic.resolution
        b.replies.push({ staffName: staff, content: `Thanks for reporting this. ${topic.resolution}`, at: b.resolvedAt })
        b.events.push({ type: 'replied', oldValue: null, newValue: topic.resolution.slice(0, 100), actor: staff, at: b.resolvedAt })
        b.events.push({ type: 'status_changed', oldValue: 'open', newValue: 'in_progress', actor: staff, at: fr })
        b.events.push({ type: 'status_changed', oldValue: 'in_progress', newValue: b.status, actor: staff, at: b.resolvedAt })
      } else if (topic.category === 'bug' && age > 4 * DAY && chance(0.7)) {
        const fr = p.ts + randInt(30, Math.max(40, sla.response * 40)) * MINUTE
        const text = 'We have fixed this in the latest release. Please update and let us know if it still happens.'
        b.firstResponseAt = fr
        b.status = 'resolved'
        b.resolvedAt = fr + randInt(2, Math.max(3, sla.resolve * 0.8)) * HOUR
        b.resolutionNotes = text
        b.replies.push({ staffName: staff, content: text, at: b.resolvedAt })
        b.events.push({ type: 'replied', oldValue: null, newValue: text.slice(0, 100), actor: staff, at: b.resolvedAt })
        b.events.push({ type: 'status_changed', oldValue: 'open', newValue: 'in_progress', actor: staff, at: fr })
        b.events.push({ type: 'status_changed', oldValue: 'in_progress', newValue: 'resolved', actor: staff, at: b.resolvedAt })
      } else if (topic.category === 'feature_request' && age > 4 * DAY && chance(0.7)) {
        const fr = p.ts + randInt(30, Math.max(40, sla.response * 40)) * MINUTE
        const text = 'Thanks for the suggestion. It is now on the roadmap, and we will post here when it ships.'
        b.firstResponseAt = fr
        b.status = 'closed'
        b.resolvedAt = fr + randInt(1, 30) * HOUR
        b.resolutionNotes = text
        b.replies.push({ staffName: staff, content: text, at: fr })
        b.events.push({ type: 'replied', oldValue: null, newValue: text.slice(0, 100), actor: staff, at: fr })
        b.events.push({ type: 'status_changed', oldValue: 'open', newValue: 'in_progress', actor: staff, at: fr })
        b.events.push({ type: 'status_changed', oldValue: 'in_progress', newValue: 'closed', actor: staff, at: b.resolvedAt })
      } else if (age > 2 * DAY && chance(0.7)) {
        const fr = p.ts + randInt(20, sla.response * 40) * MINUTE
        b.firstResponseAt = fr
        b.status = 'in_progress'
        const text = topic.category === 'bug'
          ? 'Thanks, I can reproduce this on my side. I have added it to the tracker and will update you here.'
          : 'Thanks for the suggestion. I have passed it to the product team and will let you know what they decide.'
        b.replies.push({ staffName: staff, content: text, at: fr })
        b.events.push({ type: 'replied', oldValue: null, newValue: text.slice(0, 100), actor: staff, at: fr })
        b.events.push({ type: 'status_changed', oldValue: 'open', newValue: 'in_progress', actor: staff, at: fr })
      } else {
        b.status = 'open'
      }
    } else {
      const topic = GAP_TOPICS[p.topicIndex]
      b = emptyTicket(p, topic.question, topic.category, topic.summary, chance(0.35) ? 'medium' : 'low', authorIndex)
      b.cluster = topic.cluster
      b.confidence = Math.round(rand(0.24, 0.55) * 100) / 100
      b.draft = topic.draft
      b.draftStatus = 'needs_human'
      b.severity = Math.round(rand(0.1, 0.4) * 100) / 100
      if (age > 7 * DAY && chance(0.6)) {
        const staff = nextStaff()
        const fr = p.ts + randInt(60, 600) * MINUTE
        const reply = `Thanks for asking. ${topic.draft.replace(/^I could not find[^.]*\./, '').trim() || 'I checked with the team and will follow up here.'}`
        b.firstResponseAt = fr
        b.status = 'resolved'
        b.resolvedAt = fr + randInt(1, 24) * HOUR
        b.draftStatus = 'overridden'
        b.resolutionNotes = reply
        b.replies.push({ staffName: staff, content: reply, at: fr })
        b.events.push({ type: 'replied', oldValue: null, newValue: reply.slice(0, 100), actor: staff, at: fr })
        b.events.push({ type: 'status_changed', oldValue: 'open', newValue: 'in_progress', actor: staff, at: fr })
        b.events.push({ type: 'status_changed', oldValue: 'in_progress', newValue: 'resolved', actor: staff, at: b.resolvedAt })
      } else {
        b.status = 'open'
      }
    }

    // A person acknowledges anything still waiting once it is close to its
    // response target, so the SLA numbers show a few honest misses rather than
    // every old ticket being in breach.
    const responseWindow = SLA_HOURS[b.priority].response * HOUR
    if ((b.status === 'open' || b.status === 'in_progress') && b.firstResponseAt == null && age > 0.7 * responseWindow) {
      const staff = nextStaff()
      const late = chance(0.1)
      const at = Math.min(p.ts + (late ? rand(1.1, 1.8) : rand(0.08, 0.65)) * responseWindow, now - 2 * MINUTE)
      const text = pick([
        'Thanks for the question. I am looking into this and will follow up here shortly.',
        'Got it, thanks. Checking with the team and I will update this thread.',
        'Thanks for flagging this. I am taking a look now.',
      ])
      b.firstResponseAt = Math.floor(at)
      b.status = 'in_progress'
      b.replies.push({ staffName: staff, content: text, at: b.firstResponseAt })
      b.events.push({ type: 'replied', oldValue: null, newValue: text.slice(0, 100), actor: staff, at: b.firstResponseAt })
      b.events.push({ type: 'status_changed', oldValue: 'open', newValue: 'in_progress', actor: staff, at: b.firstResponseAt })
    }

    // SLA bookkeeping from the timeline above.
    const sla = SLA_HOURS[b.priority]
    const respondBy = p.ts + sla.response * HOUR
    const resolveBy = p.ts + sla.resolve * HOUR
    if (b.firstResponseAt != null) b.slaResponseMet = b.firstResponseAt <= respondBy ? 1 : 0
    else if (now > respondBy) b.slaResponseMet = 0
    if (b.resolvedAt != null) b.slaResolveMet = b.resolvedAt <= resolveBy ? 1 : 0
    else if (now > resolveBy) b.slaResolveMet = 0

    // Message ids must be unique within a workspace.
    while (usedMessageIds.has(b.source.messageId)) b.source.messageId += 'x'
    usedMessageIds.add(b.source.messageId)

    b.events.sort((x, y) => x.at - y.at)
    built.push(b)
  }
  return polishTickets(built, now)
}

// Written for the FAQ page, which prints the text as-is: plain sentences, no markdown.
const FAQ_ENTRIES: Array<[string, string]> = [
  ['How do I install RoverKit on a Raspberry Pi 5?', 'Create a virtual environment first, activate it, then install RoverKit with pip. Raspberry Pi OS protects its system Python, so installing globally fails with an externally-managed-environment error.'],
  ['How do I update the firmware on my Atlas-2?', 'Put the board into bootloader mode, then run the firmware flash command from the command-line tool. Keep the board powered until the status light turns solid green.'],
  ['Why does my arm servo buzz at its end stop?', 'The servo is being driven past its real range. Run the servo calibration wizard with the arm unloaded and it will store safe limits for you.'],
  ['Can I test my code before the hardware arrives?', 'Yes. The RoverSim simulator runs the same Python API against a virtual robot, so your navigation scripts work unchanged once the board shows up.'],
  ['Which battery packs does the Atlas-2 support?', 'The Atlas-2 supports 2S and 3S LiPo packs with an XT30 connector. A 4S pack is too high a voltage and is not safe to use.'],
  ['Why does the command-line tool say device not found?', 'This is usually a serial permission problem. Add your user to the dialout group, then log out and back in.'],
  ['Does RoverKit support ROS 2?', 'Yes. Install the ROS 2 extra and start the bridge from the command-line tool. It publishes odometry and accepts velocity commands.'],
  ['How long is the warranty on the Atlas-2?', 'Northwind hardware has a 12-month warranty against manufacturing defects. Damage from over-voltage, reverse polarity and water is not covered.'],
  ['Can I use RoverKit on macOS?', 'RoverKit installs on macOS 13 or newer, but only the simulator and the command-line tools work there. Hardware access needs Linux.'],
  ['Do you offer discounts for schools and robotics clubs?', 'Yes. Clubs and schools get 15 percent off orders of five or more Atlas-2 boards. Contact the support team to claim it.'],
]

/**
 * Final, deterministic pass (it draws no random numbers, so the tickets above
 * keep their numbers and topics). It shapes the workspace into a busy, healthy
 * one for the screenshots:
 *
 * - most auto-answered tickets read as answered ("Approved") rather than
 *   "Posted ... awaiting review"; every fourth stays in the posted state;
 * - a handful of recent, unanswered, in-window tickets are open, across
 *   several channels and categories;
 * - only a few response-time misses remain, all on tickets still unresolved.
 */
// Ticket numbers that shots.manifest.ts opens by URL (an auto-answered ticket and
// one waiting for review); the pass below never changes their state.
const SHOWCASE_TICKETS = new Set([73, 75])

function polishTickets(built: BuiltTicket[], now: number): BuiltTicket[] {
  const resolved = (b: BuiltTicket) => b.status === 'resolved' || b.status === 'closed'

  // Open backlog: the newest tickets that no one has answered yet. A recent
  // auto-answered ticket can be turned into one waiting for a person.
  const perPlatform = new Map<string, number>()
  const perCategory = new Map<string, number>()
  const reopenedDays = new Set<number>()
  let opened = built.filter((b) => SHOWCASE_TICKETS.has(b.planned.number) && b.status === 'open').length
  const newestFirst = [...built].sort((a, b) => b.planned.ts - a.planned.ts)
  for (const b of newestFirst) {
    if (opened >= 8) break
    if (SHOWCASE_TICKETS.has(b.planned.number)) continue
    // Issues keep their priority; questions are low priority (72 hour target).
    // Nothing older than about four days is reopened.
    const priority: Priority = b.planned.kind === 'issue' ? b.priority : 'low'
    if (now - b.planned.ts > 1.3 * SLA_HOURS[priority].response * HOUR) continue
    // Reopening more than one auto-answered ticket a day would leave a day on the
    // deflection chart with nothing deflected.
    const day = Math.floor(b.planned.ts / DAY)
    if (b.deflected && reopenedDays.has(day)) continue
    if ((perPlatform.get(b.planned.platform) ?? 0) >= 3 || (perCategory.get(b.category) ?? 0) >= 4) continue
    perPlatform.set(b.planned.platform, (perPlatform.get(b.planned.platform) ?? 0) + 1)
    perCategory.set(b.category, (perCategory.get(b.category) ?? 0) + 1)
    opened++
    b.priority = priority
    if (b.deflected) {
      reopenedDays.add(day)
      b.deflected = false
      b.confidence = 0.62 + (b.planned.number % 5) * 0.04
    }
    b.status = 'open'
    b.firstResponseAt = null
    b.resolvedAt = null
    b.resolutionNotes = null
    b.slaResponseMet = null
    b.slaResolveMet = null
    b.draftPostedAt = null
    b.draftStatus = 'needs_human'
    b.replies = []
    b.events = b.events.filter((e) => e.type === 'created')
  }

  // Older answered questions that staff handled by hand: let the assistant have
  // answered some of them so the deflection rate reads as healthy (about 72%).
  const assessedCount = built.filter((b) => b.confidence != null && b.category !== 'bug' && b.category !== 'feature_request').length
  let deflectedCount = built.filter((b) => b.deflected).length
  for (const b of built) {
    if (deflectedCount >= Math.ceil(0.72 * assessedCount)) break
    if (b.planned.kind !== 'answered' || b.deflected || !resolved(b) || now - b.planned.ts < 2 * DAY) continue
    const fr = b.planned.ts + (1 + (b.planned.number % 3)) * MINUTE
    const done = fr + (20 + (b.planned.number % 6) * 10) * MINUTE
    b.deflected = true
    b.confidence = 0.83 + (b.planned.number % 7) * 0.02
    b.status = 'resolved'
    b.firstResponseAt = fr
    b.resolvedAt = done
    b.slaResponseMet = 1
    b.slaResolveMet = 1
    b.draftPostedAt = iso(fr)
    b.resolutionNotes = b.draft
    b.replies = []
    b.events = [
      b.events[0],
      { type: 'ai_draft_posted', oldValue: null, newValue: 'posted', actor: 'system', at: fr },
      { type: 'status_changed', oldValue: 'open', newValue: 'resolved', actor: 'system', at: done },
    ]
    deflectedCount++
  }

  // Auto-answered tickets read as answered ("Approved") rather than "Posted ...
  // awaiting review"; every fourth stays in the posted state.
  for (const b of built) {
    if (b.deflected) b.draftStatus = b.planned.number % 4 === 0 ? 'posted' : 'approved'
  }

  // Keep the three newest unresolved misses; clear the rest.
  const missed = (b: BuiltTicket) => b.slaResponseMet === 0 || b.slaResolveMet === 0
  const keep = new Set(
    newestFirst.filter((b) => missed(b) && !resolved(b)).slice(0, 3).map((b) => b.planned.number)
  )
  for (const b of built) {
    if (!missed(b) || keep.has(b.planned.number)) continue
    const sla = SLA_HOURS[b.priority]
    const retime = (from: number, to: number) => {
      for (const r of b.replies) if (r.at === from) r.at = to
      for (const e of b.events) if (e.at === from) e.at = to
    }
    if (b.slaResponseMet === 0 && b.firstResponseAt != null) {
      const to = b.planned.ts + Math.min(b.firstResponseAt - b.planned.ts, 0.6 * sla.response * HOUR)
      retime(b.firstResponseAt, to)
      b.firstResponseAt = to
    }
    if (b.firstResponseAt != null) b.slaResponseMet = 1
    if (b.slaResolveMet === 0) {
      if (b.resolvedAt != null) {
        const to = Math.min(
          Math.max((b.firstResponseAt ?? b.planned.ts) + HOUR, b.planned.ts + 0.8 * sla.resolve * HOUR),
          b.planned.ts + sla.resolve * HOUR - MINUTE
        )
        retime(b.resolvedAt, to)
        b.resolvedAt = to
      } else {
        const to = Math.min(b.planned.ts + 0.8 * sla.resolve * HOUR, now - HOUR)
        const text = 'Thanks for your patience. This is sorted now, so I am closing it out. Reply here if it comes back.'
        const staff = b.replies.find((r) => r.staffName !== 'Customer')?.staffName ?? STAFF[0].name
        b.status = 'resolved'
        b.resolvedAt = to
        b.resolutionNotes = text
        b.replies.push({ staffName: staff, content: text, at: to })
        b.events.push({ type: 'replied', oldValue: null, newValue: text.slice(0, 100), actor: staff, at: to })
        b.events.push({ type: 'status_changed', oldValue: 'in_progress', newValue: 'resolved', actor: staff, at: to })
      }
      b.slaResolveMet = 1
    }
    b.events.sort((x, y) => x.at - y.at)
    b.replies.sort((x, y) => x.at - y.at)
  }
  return built
}

function emptyTicket(
  p: PlannedTicket,
  content: string,
  category: string,
  summary: string,
  priority: Priority,
  authorIndex: number
): BuiltTicket {
  return {
    planned: p,
    content,
    category,
    summary,
    priority,
    status: 'open',
    draft: null,
    draftStatus: 'pending',
    skipReason: null,
    draftPostedAt: null,
    resolutionNotes: null,
    firstResponseAt: null,
    resolvedAt: null,
    slaResponseMet: null,
    slaResolveMet: null,
    confidence: null,
    deflected: false,
    severity: 0.2,
    cluster: null,
    replies: [],
    events: [{ type: 'created', oldValue: null, newValue: null, actor: 'system', at: p.ts }],
    source: sourceFor(p.platform, p.ts, authorIndex, summary),
  }
}

// ---------------------------------------------------------------------------
// Wipe (demo workspace only)
// ---------------------------------------------------------------------------

async function wipeDemoWorkspace(orgId: number) {
  const { getDb } = await import('@/lib/db/drizzle')
  const { sql } = await import('drizzle-orm')
  const db = getDb()
  const t = sql`(SELECT id FROM tickets WHERE org_id = ${orgId})`
  const demoUsers = sql`(SELECT id FROM users WHERE provider = ${DEMO_PROVIDER})`

  const statements = [
    sql`DELETE FROM product_updates WHERE created_by IN ${demoUsers}`,
    sql`DELETE FROM product_feedback WHERE org_id = ${orgId} OR user_id IN ${demoUsers}`,
    sql`DELETE FROM kb_article_events WHERE org_id = ${orgId}`,
    sql`DELETE FROM kb_article_usage WHERE org_id = ${orgId}`,
    sql`DELETE FROM kb_review_items WHERE org_id = ${orgId}`,
    sql`DELETE FROM csat_ratings WHERE org_id = ${orgId}`,
    sql`DELETE FROM csat_messages WHERE ticket_id IN ${t}`,
    sql`DELETE FROM ticket_feedback WHERE ticket_id IN ${t}`,
    sql`DELETE FROM answer_messages WHERE ticket_id IN ${t}`,
    sql`DELETE FROM ai_assessments WHERE ticket_id IN ${t}`,
    sql`DELETE FROM ticket_links WHERE ticket_id IN ${t} OR related_id IN ${t}`,
    sql`DELETE FROM ticket_embeddings WHERE ticket_id IN ${t}`,
    sql`DELETE FROM ticket_events WHERE ticket_id IN ${t}`,
    sql`DELETE FROM ticket_replies WHERE ticket_id IN ${t}`,
    sql`DELETE FROM email_messages WHERE org_id = ${orgId}`,
    sql`DELETE FROM notifications WHERE org_id = ${orgId}`,
    sql`DELETE FROM kb_articles WHERE org_id = ${orgId}`,
    sql`DELETE FROM kb_sync_jobs WHERE org_id = ${orgId}`,
    sql`DELETE FROM kb_sources WHERE org_id = ${orgId}`,
    sql`DELETE FROM notion_connections WHERE org_id = ${orgId}`,
    sql`DELETE FROM tickets WHERE org_id = ${orgId}`,
    sql`DELETE FROM api_generations WHERE org_id = ${orgId}`,
    sql`DELETE FROM api_keys WHERE org_id = ${orgId}`,
    sql`DELETE FROM integrations WHERE org_id = ${orgId}`,
    sql`DELETE FROM discord_guilds WHERE org_id = ${orgId}`,
    sql`DELETE FROM github_repos WHERE org_id = ${orgId}`,
    sql`DELETE FROM email_domains WHERE org_id = ${orgId}`,
    sql`DELETE FROM email_oauth_connections WHERE org_id = ${orgId}`,
    sql`DELETE FROM faq_snapshots WHERE org_id = ${orgId}`,
    sql`DELETE FROM push_subscriptions WHERE org_id = ${orgId}`,
    sql`DELETE FROM invitations WHERE org_id = ${orgId}`,
    sql`DELETE FROM widget_leads WHERE org_id = ${orgId}`,
    sql`DELETE FROM ai_configs WHERE org_id = ${orgId}`,
    sql`DELETE FROM subscriptions WHERE org_id = ${orgId}`,
    sql`DELETE FROM platform_ai_usage WHERE org_id = ${orgId}`,
    sql`DELETE FROM org_feature_flags WHERE org_id = ${orgId}`,
    sql`DELETE FROM slack_poll_cursors WHERE org_id = ${orgId}`,
    sql`DELETE FROM sla_configs WHERE org_id = ${orgId}`,
    sql`DELETE FROM memberships WHERE org_id = ${orgId}`,
  ]
  for (const stmt of statements) await db.execute(stmt)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  assertLocalDatabaseUrl(process.env.DATABASE_URL)
  if (process.env.DIRECT_DATABASE_URL) assertLocalDatabaseUrl(process.env.DIRECT_DATABASE_URL, 'DIRECT_DATABASE_URL')

  const { runMigrations } = await import('@/lib/db/migrate')
  const { getDb } = await import('@/lib/db/drizzle')
  const { eq, inArray, sql } = await import('drizzle-orm')
  const s = await import('@/lib/db/schema')
  const { encryptToken } = await import('@/lib/crypto/tokens')
  const { hashBotSecret } = await import('@/lib/ingest/bot-secret')
  const { generateApiKey } = await import('@/lib/mcp/keys')
  const { contentHash } = await import('@/lib/kb/revision')

  console.log('[docs-demo] applying migrations')
  await runMigrations()
  const db = getDb()
  const now = Date.now()

  // ---- Organization -------------------------------------------------------
  let [org] = await db.select({ id: s.orgs.id }).from(s.orgs).where(eq(s.orgs.slug, DEMO_ORG_SLUG)).limit(1)
  if (org) {
    console.log(`[docs-demo] wiping existing demo workspace (org ${org.id})`)
    await wipeDemoWorkspace(org.id)
  } else {
    ;[org] = await db.insert(s.orgs).values({ name: DEMO_ORG_NAME, slug: DEMO_ORG_SLUG }).returning({ id: s.orgs.id })
  }
  const orgId = org.id

  await db
    .update(s.orgs)
    .set({
      name: DEMO_ORG_NAME,
      onboardedAt: iso(now - 75 * DAY),
      widgetToken: `wt_${hex(16)}`,
      widgetTokenExpiresAt: null,
      widgetAllowedOrigins: 'docs.example.com\nforum.example.org',
      roiMinutesPerTicket: 12,
      roiStaffHourlyRate: 45,
      embeddingModelInUse: EMBEDDING_MODEL,
      deletedAt: null,
      trialChatSpendMicros: 0,
      trialEmbeddingSpendMicros: 0,
      createdAt: iso(now - 75 * DAY),
    })
    .where(eq(s.orgs.id, orgId))

  // ---- People -------------------------------------------------------------
  // Users are upserted rather than recreated so their ids (and therefore a
  // session cookie minted by session.ts) survive a re-seed.
  const existingUsers = await db
    .select({ email: s.users.email, provider: s.users.provider })
    .from(s.users)
    .where(inArray(s.users.email, STAFF.map((p) => p.email)))
  const foreign = existingUsers.find((u) => u.provider !== DEMO_PROVIDER)
  if (foreign) throw new Error(`Refusing to reuse ${foreign.email}: that user was not created by the docs demo seed.`)
  const userRows = await db
    .insert(s.users)
    .values(STAFF.map((p, i) => ({ email: p.email, name: p.name, provider: DEMO_PROVIDER, createdAt: iso(now - (75 - i * 6) * DAY) })))
    .onConflictDoUpdate({ target: s.users.email, set: { name: sql`excluded.name` } })
    .returning({ id: s.users.id, email: s.users.email })
  const userId = (email: string) => userRows.find((u) => u.email === email)!.id
  await db.insert(s.memberships).values(
    STAFF.map((p, i) => ({ userId: userId(p.email), orgId, role: p.role, createdAt: iso(now - (75 - i * 6) * DAY) }))
  )
  const ownerId = userId(DEMO_OWNER_EMAIL)
  const staffByName = new Map(STAFF.map((p) => [p.name, userId(p.email)]))

  await db.insert(s.invitations).values([
    { orgId, email: 'jordan.ellis@example.com', role: 'member', token: hex(24), invitedBy: ownerId, expiresAt: iso(now + 5 * DAY), createdAt: iso(now - 2 * DAY) },
    { orgId, email: 'amara.osei@example.com', role: 'admin', token: hex(24), invitedBy: ownerId, expiresAt: iso(now + 3 * DAY), createdAt: iso(now - 4 * DAY) },
  ])

  // ---- Billing ------------------------------------------------------------
  // Self-hosted mode bypasses the subscription gate entirely; this row is here
  // so the Billing page and plan-aware screens show a paid plan.
  await db.insert(s.subscriptions).values({
    orgId,
    planId: 'pro',
    status: 'active',
    currentPeriodStart: iso(now - 12 * DAY),
    currentPeriodEnd: iso(now + 18 * DAY),
    cancelAtPeriodEnd: 0,
    createdAt: iso(now - 70 * DAY),
    updatedAt: iso(now - 12 * DAY),
  })
  const period = new Date(now).toISOString().slice(0, 7)
  await db.insert(s.platformAiUsage).values({ orgId, period, chatSpendMicros: 4_180_000, embeddingSpendMicros: 210_000 })

  // ---- AI configuration (provider chosen, deliberately no key) -----------
  await db.insert(s.aiConfigs).values({
    orgId,
    chatProvider: 'anthropic',
    chatModel: 'claude-sonnet-4-5',
    embeddingProvider: 'openai',
    embeddingModel: EMBEDDING_MODEL,
  })

  // ---- Knowledge sources --------------------------------------------------
  const sourceIds = new Map<KbSourceKey, number>()
  const chunkCounts: Record<Exclude<KbSourceKey, 'manual'>, number> = { url_start: 14, url_api: 31, pdf: 46, github: 38, notion: 12 }
  for (const [key, meta] of Object.entries(KB_SOURCE_META) as Array<[Exclude<KbSourceKey, 'manual'>, (typeof KB_SOURCE_META)[Exclude<KbSourceKey, 'manual'>]]>) {
    const [row] = await db
      .insert(s.kbSources)
      .values({ orgId, ...meta, chunkCount: chunkCounts[key], createdAt: iso(now - rand(40, 70) * DAY), updatedAt: iso(now - rand(2, 10) * DAY) })
      .returning({ id: s.kbSources.id })
    sourceIds.set(key, row.id)
  }

  // ---- Integrations (credentials are random, generated here, never stored in the repo)
  const channelMap = Object.fromEntries(DISCORD_CHANNELS.map((c) => [c, DISCORD_GUILD_ID]))
  const integrationRow = (platform: string, extra: Record<string, unknown> = {}) => {
    const secret = hex(32)
    return {
      orgId,
      platform,
      botSecretHash: hashBotSecret(secret),
      botSecretEnc: encryptToken(secret),
      enabled: 1,
      autoDeflectEnabled: 1,
      confidenceThreshold: 0.8,
      createdAt: iso(now - 60 * DAY),
      updatedAt: iso(now - 3 * DAY),
      ...extra,
    }
  }
  await db.insert(s.integrations).values([
    integrationRow('discord', {
      botToken: encryptToken(hex(30)),
      channelIds: JSON.stringify(DISCORD_CHANNELS),
      guildChannelMap: JSON.stringify(channelMap),
      connectedGuildId: DISCORD_GUILD_ID,
      escalationRoleId: '1190000000000000099',
    }),
    integrationRow('slack', {
      botToken: encryptToken(hex(30)),
      teamId: SLACK_TEAM_ID,
      channelIds: JSON.stringify(SLACK_CHANNELS),
      escalationRoleId: 'U0DEMO0001',
      webhookSecret: encryptToken(hex(24)),
    }),
    integrationRow('discourse', {
      teamId: DISCOURSE_SITE,
      botUsername: 'rover-helper',
      botToken: encryptToken(hex(24)),
      webhookSecret: encryptToken(hex(24)),
      channelIds: JSON.stringify(['7']),
      escalationRoleId: 'marcus.webb',
    }),
    integrationRow('circle', {
      teamId: CIRCLE_SITE,
      botToken: encryptToken(hex(24)),
      channelIds: JSON.stringify(['help']),
    }),
    integrationRow('telegram', {
      botToken: encryptToken(hex(24)),
      webhookRegisteredAt: iso(now - 20 * DAY),
      channelIds: JSON.stringify(['-1009000000001']),
    }),
    integrationRow('email', { emailSendMethod: 'domain' }),
  ])
  await db.insert(s.discordGuilds).values({
    orgId,
    guildId: DISCORD_GUILD_ID,
    guildName: 'Northwind Robotics Community',
    channelIds: JSON.stringify(DISCORD_CHANNELS),
    escalationRoleId: '1190000000000000099',
    enabled: 1,
    createdAt: iso(now - 60 * DAY),
    updatedAt: iso(now - 3 * DAY),
  })
  await db.insert(s.emailDomains).values({
    orgId,
    domain: 'support.example.org',
    providerDomainId: `domain-${hex(6)}`,
    dkimRecordName: 'send._domainkey.support.example.org',
    dkimRecordValue: '<dkim-public-key>',
    returnPathRecordName: 'send.support.example.org',
    returnPathRecordValue: 'feedback-smtp.example.net',
    receivingRecordName: 'support.example.org',
    receivingRecordValue: 'inbound-smtp.example.net',
    receivingRecordPriority: 10,
    status: 'verified',
    lastCheckedAt: iso(now - 1 * DAY),
    verifiedAt: iso(now - 58 * DAY),
    createdAt: iso(now - 59 * DAY),
    updatedAt: iso(now - 1 * DAY),
  })
  const [repo] = await db
    .insert(s.githubRepos)
    .values({
      orgId,
      installationId: 1000001,
      owner: 'northwind-robotics-demo',
      repo: 'roverkit-docs',
      isPrivate: 0,
      monitoredEvents: 'both',
      kbEnabled: 1,
      kbLastSynced: iso(now - 2 * DAY),
      kbChunkCount: chunkCounts.github,
      autoDeflectEnabled: 1,
      addedAt: iso(now - 55 * DAY),
    })
    .returning({ id: s.githubRepos.id })
  await db.insert(s.notionConnections).values({
    orgId,
    accessToken: encryptToken(hex(30)),
    workspaceName: 'Northwind Robotics Wiki',
    kbSourceId: sourceIds.get('notion'),
    kbLastSynced: iso(now - 3 * DAY),
    kbChunkCount: chunkCounts.notion,
    createdAt: iso(now - 45 * DAY),
    updatedAt: iso(now - 3 * DAY),
  })
  await db.insert(s.kbSyncJobs).values([
    { orgId, kind: 'github_repo', repoId: repo.id, status: 'succeeded', syncedCount: 6, progress: 6, total: 6, attempts: 1, createdAt: iso(now - 2 * DAY), startedAt: iso(now - 2 * DAY + MINUTE), finishedAt: iso(now - 2 * DAY + 4 * MINUTE) },
    { orgId, kind: 'notion', status: 'succeeded', syncedCount: 2, progress: 2, total: 2, attempts: 1, createdAt: iso(now - 3 * DAY), startedAt: iso(now - 3 * DAY + MINUTE), finishedAt: iso(now - 3 * DAY + 3 * MINUTE) },
  ])

  // ---- Tickets ------------------------------------------------------------
  const built = buildTickets(now)
  console.log(`[docs-demo] writing ${built.length} tickets`)
  await db.update(s.orgs).set({ nextTicketNumber: built.length + 1 }).where(eq(s.orgs.id, orgId))

  const ticketRows = await db
    .insert(s.tickets)
    .values(
      built.map((b) => ({
        orgId,
        orgTicketNumber: b.planned.number,
        sourceMessageId: b.source.messageId,
        discordGuildId: b.source.guildId,
        sourceChannelId: b.source.channelId,
        sourceThreadId: b.source.threadId,
        sourceAuthorId: b.source.authorId,
        sourceAuthorName: b.source.authorName,
        sourceUrl: b.source.url,
        sourcePlatform: b.planned.platform,
        content: b.content,
        category: b.category,
        severityScore: b.severity,
        aiSummary: b.summary,
        aiSuggestedPriority: b.priority,
        aiDraft: b.draft,
        aiDraftStatus: b.draftStatus,
        aiDraftSkipReason: b.skipReason,
        aiDraftPostedAt: b.draftPostedAt,
        priority: b.priority,
        status: b.status,
        resolutionNotes: b.resolutionNotes,
        slaResponseDeadline: iso(b.planned.ts + SLA_HOURS[b.priority].response * HOUR),
        slaResolveDeadline: iso(b.planned.ts + SLA_HOURS[b.priority].resolve * HOUR),
        slaResponseMet: b.slaResponseMet,
        slaResolveMet: b.slaResolveMet,
        firstResponseAt: b.firstResponseAt != null ? iso(b.firstResponseAt) : null,
        resolvedAt: b.resolvedAt != null ? iso(b.resolvedAt) : null,
        createdAt: iso(b.planned.ts),
        updatedAt: iso(b.resolvedAt ?? b.events[b.events.length - 1]?.at ?? b.planned.ts),
      }))
    )
    .returning({ id: s.tickets.id, n: s.tickets.orgTicketNumber })
  const ticketId = new Map(ticketRows.map((r) => [r.n, r.id]))
  const idOf = (b: BuiltTicket) => ticketId.get(b.planned.number)!

  await db.insert(s.ticketEvents).values(
    built.flatMap((b) => b.events.map((e) => ({ ticketId: idOf(b), eventType: e.type, oldValue: e.oldValue, newValue: e.newValue, actor: e.actor, createdAt: iso(e.at) })))
  )
  const replyRows = built.flatMap((b) => b.replies.map((r) => ({ ticketId: idOf(b), staffName: r.staffName, content: r.content, createdAt: iso(r.at) })))
  if (replyRows.length) await db.insert(s.ticketReplies).values(replyRows)

  const assessed = built.filter((b) => b.confidence != null)
  await db.insert(s.aiAssessments).values(
    assessed.map((b) => ({
      ticketId: idOf(b),
      confidence: b.confidence!,
      answeredFully: b.confidence! >= 0.8 ? 1 : 0,
      autoDeflected: b.deflected ? 1 : 0,
      reasoning:
        b.confidence! >= 0.8
          ? 'The retrieved articles directly cover this question and the answer follows them closely.'
          : b.confidence! >= 0.6
            ? 'Related articles were found, but they only partly cover this question, so a person should confirm before it is sent.'
            : 'No article in the knowledge base covers this question, so the answer is a best guess and needs a person.',
      model: 'claude-sonnet-4-5',
      createdAt: iso((b.firstResponseAt ?? b.planned.ts) + 20 * 1000),
    }))
  )

  // Answer messages and thumbs votes on answers the AI or staff posted.
  const answered = built.filter((b) => b.deflected || b.draftStatus === 'approved')
  const answerRows = answered.map((b) => ({ discordMessageId: fakeSnowflake((b.firstResponseAt ?? b.planned.ts) + 1000), ticketId: idOf(b), createdAt: iso((b.firstResponseAt ?? b.planned.ts) + 1000) }))
  if (answerRows.length) await db.insert(s.answerMessages).values(answerRows)
  const feedbackRows: Array<typeof s.ticketFeedback.$inferInsert> = []
  for (const b of answered) {
    if (!chance(0.5)) continue
    const source = b.planned.platform === 'slack' ? 'slack' : 'discord'
    feedbackRows.push({
      ticketId: idOf(b),
      source,
      vote: chance(0.86) ? 'up' : 'down',
      actor: `member-${randInt(100, 999)}`,
      createdAt: iso((b.firstResponseAt ?? b.planned.ts) + randInt(2, 90) * MINUTE),
    })
  }
  for (const b of built.filter((x) => x.deflected).slice(0, 14)) {
    feedbackRows.push({ ticketId: idOf(b), source: 'staff', vote: chance(0.9) ? 'up' : 'down', actor: pick(STAFF).name, createdAt: iso((b.resolvedAt ?? b.planned.ts) + 3 * HOUR) })
  }
  // The auto-answered ticket shown in the docs has a thumbs-up from a community member.
  const showcase = built.find((b) => b.deflected && SHOWCASE_TICKETS.has(b.planned.number))
  if (showcase && !feedbackRows.some((f) => f.ticketId === idOf(showcase) && f.source !== 'staff')) {
    feedbackRows.push({ ticketId: idOf(showcase), source: 'discord', vote: 'up', actor: 'member-412', createdAt: iso((showcase.firstResponseAt ?? showcase.planned.ts) + 12 * MINUTE) })
  }
  if (feedbackRows.length) await db.insert(s.ticketFeedback).values(feedbackRows)

  // Satisfaction ratings on resolved tickets, skewed positive with a realistic tail.
  const csatRows: Array<typeof s.csatRatings.$inferInsert> = []
  for (const b of built) {
    if (b.status !== 'resolved' && b.status !== 'closed') continue
    if (!chance(0.62)) continue
    const rating = weightedPick<number>([[5, 52], [4, 28], [3, 11], [2, 5], [1, 4]])
    csatRows.push({ ticketId: idOf(b), orgId, rating, platform: b.planned.platform, createdAt: iso((b.resolvedAt ?? b.planned.ts) + randInt(10, 240) * MINUTE) })
  }
  if (csatRows.length) await db.insert(s.csatRatings).values(csatRows)

  // Embeddings only for knowledge-gap tickets: they are what the Knowledge Gaps
  // page uses to fold repeats of one question into a single row.
  const clusterNames = [...new Set(GAP_TOPICS.map((g) => g.cluster))]
  const DIM = 32
  const clusterBase = new Map(
    clusterNames.map((name, i) => {
      const v = new Array<number>(DIM).fill(0)
      v[i] = 1
      return [name, v] as const
    })
  )
  const gapTickets = built.filter((b) => b.cluster)
  await db.insert(s.ticketEmbeddings).values(
    gapTickets.map((b) => {
      const base = clusterBase.get(b.cluster!)!
      const noisy = base.map((x) => Math.round((x + (rng() - 0.5) * 0.04) * 1e5) / 1e5)
      return { ticketId: idOf(b), vector: JSON.stringify(noisy), model: EMBEDDING_MODEL, createdAt: iso(b.planned.ts + 30 * 1000) }
    })
  )
  const linkRows: Array<typeof s.ticketLinks.$inferInsert> = []
  for (const name of clusterNames) {
    const members = gapTickets.filter((b) => b.cluster === name)
    for (let i = 1; i < members.length; i++) {
      linkRows.push({ ticketId: idOf(members[i]), relatedId: idOf(members[0]), score: Math.round(rand(0.88, 0.96) * 100) / 100 })
    }
  }
  if (linkRows.length) await db.insert(s.ticketLinks).values(linkRows)

  // Notifications: a rolling feed, the newest few still unread.
  const recent = [...built].sort((a, b) => b.planned.ts - a.planned.ts).slice(0, 22)
  await db.insert(s.notifications).values(
    recent.map((b, i) => {
      const n = b.planned.number
      let type: 'new_question' | 'sla_breach' | 'ai_draft_ready' = 'new_question'
      let message = `New question from ${b.source.authorName}: ${b.summary} (ticket #${n})`
      if (b.deflected) {
        type = 'ai_draft_ready'
        message = `Auto-answered (${Math.round(b.confidence! * 100)}%) - ticket #${n}`
      } else if (b.draftStatus === 'needs_human' && b.draft) {
        type = 'ai_draft_ready'
        message = `Draft ready for review (${Math.round(b.confidence! * 100)}%) - ticket #${n}`
      } else if (b.slaResponseMet === 0 && b.status !== 'resolved' && b.status !== 'closed') {
        type = 'sla_breach'
        message = `Response SLA breached - ticket #${n}`
      }
      return { orgId, ticketId: idOf(b), type, message, read: i < 6 ? 0 : 1, createdAt: iso(b.planned.ts + MINUTE) }
    })
  )

  // ---- Knowledge-base articles -------------------------------------------
  const promotedFrom: Record<string, string> = {
    'usb-notfound': 'Fix device not found',
    warranty: 'Warranty length',
    gamepad: 'Pair a gamepad',
    doctor: 'Diagnostics for support',
  }
  const reviewApproved = new Set(['gamepad', 'doctor'])
  const articleRows = KB_ARTICLES.map((a, i) => {
    const vec = randomUnitVector(1536)
    const topicSummary = promotedFrom[a.key]
    const sourceTicket = topicSummary ? built.find((b) => b.summary === topicSummary) : undefined
    const createdMs = now - (a.source === 'manual' ? rand(22, 45) : rand(34, 60)) * DAY
    return {
      meta: a,
      values: {
        orgId,
        question: a.question,
        answer: a.answer,
        embedding: JSON.stringify(vec),
        embeddingVec: vec,
        model: EMBEDDING_MODEL,
        sourceTicketId: sourceTicket ? idOf(sourceTicket) : null,
        sourceId: a.source === 'manual' ? null : sourceIds.get(a.source)!,
        sourcePage: a.source === 'pdf' ? randInt(3, 40) : null,
        published: a.source === 'notion' ? 0 : 1,
        createdBy: a.source === 'manual' ? staffByName.get(STAFF[i % 3].name)! : null,
        createdAt: iso(createdMs),
        updatedAt: iso(createdMs + rand(0, 6) * DAY),
      },
    }
  })
  const articleIds = await db.insert(s.kbArticles).values(articleRows.map((r) => r.values)).returning({ id: s.kbArticles.id })
  const idByKey = new Map(articleRows.map((r, i) => [r.meta.key, articleIds[i].id]))

  // Review queue: answers the assistant gave without article coverage.
  const heldTickets = built.filter((b) => b.draftStatus === 'needs_human' && b.draft && b.skipReason == null)
  const pendingItems = [
    { q: 'Can I use an Arduino Nano as a co-processor with the Atlas-2?', a: 'Yes. Connect it to the UART-A header at 115200 baud and use `rover.serial.open("uart-a")` to exchange messages. Keep logic on the Atlas-2 and use the Nano for extra analog inputs.', c: 0.64, occ: 3, src: 'widget' },
    { q: 'How do I reset the servo hat to factory defaults?', a: 'Run `rover-cli reset --servo` to clear the stored calibration for every channel, then calibrate again.', c: 0.71, occ: 2, src: 'ticket' },
    { q: 'Does RoverSim support multiple robots at once?', a: 'Yes. Start the world with `--robots 2` and connect to each robot with its own name. Each robot gets an independent set of simulated sensors.', c: 0.58, occ: 4, src: 'widget' },
    { q: 'What is the maximum cable length for the Scout-L1 UART?', a: 'Keep the cable under 1 metre at 115200 baud. Longer runs need a lower baud rate and a twisted pair.', c: 0.66, occ: 1, src: 'ticket' },
    { q: 'How do I log in to the telemetry dashboard with a password?', a: 'Set `telemetry.password` in `rover.toml`. The dashboard then asks for it before showing live data.', c: 0.69, occ: 2, src: 'ticket' },
  ]
  const reviewRows = [
    ...pendingItems.map((it, i) => {
      const vec = randomUnitVector(1536)
      return {
        orgId, source: it.src, ticketId: it.src === 'ticket' ? idOf(heldTickets[i % Math.max(1, heldTickets.length)]) : null,
        question: it.q, answer: it.a, embeddingVec: vec, model: EMBEDDING_MODEL, confidence: it.c, occurrences: it.occ,
        status: 'pending', createdAt: iso(now - (i * 1.4 + 0.5) * DAY), updatedAt: iso(now - (i * 1.4 + 0.2) * DAY),
      }
    }),
    { orgId, source: 'ticket', ticketId: null, question: 'Is there a discount for bulk orders?', answer: 'Sales questions are handled by the team directly.', embeddingVec: randomUnitVector(1536), model: EMBEDDING_MODEL, confidence: 0.52, occurrences: 1, status: 'rejected', reviewedBy: userId('marcus.webb@example.com'), reviewedAt: iso(now - 9 * DAY), createdAt: iso(now - 10 * DAY), updatedAt: iso(now - 9 * DAY) },
    ...[...reviewApproved].map((key) => {
      const a = KB_ARTICLES.find((x) => x.key === key)!
      return { orgId, source: 'ticket', ticketId: null, question: a.question, answer: a.answer, embeddingVec: randomUnitVector(1536), model: EMBEDDING_MODEL, confidence: 0.74, occurrences: 2, status: 'approved', articleId: idByKey.get(key)!, reviewedBy: userId('priya.raman@example.com'), reviewedAt: iso(now - 15 * DAY), createdAt: iso(now - 16 * DAY), updatedAt: iso(now - 15 * DAY) }
    }),
  ]
  const reviewIds = await db.insert(s.kbReviewItems).values(reviewRows).returning({ id: s.kbReviewItems.id, articleId: s.kbReviewItems.articleId })

  // Article history.
  const events: Array<typeof s.kbArticleEvents.$inferInsert> = []
  for (const r of articleRows) {
    const id = idByKey.get(r.meta.key)!
    const hash = contentHash(r.meta.question, r.meta.answer)
    const created = r.values.createdAt
    if (reviewApproved.has(r.meta.key)) {
      const rv = reviewIds.find((x) => x.articleId === id)
      events.push({ orgId, articleId: id, type: 'review_approved', actorUserId: userId('priya.raman@example.com'), origin: 'review_queue', reviewItemId: rv?.id ?? null, contentHash: hash, createdAt: iso(now - 15 * DAY) })
    } else if (r.values.sourceTicketId) {
      events.push({ orgId, articleId: id, type: 'promoted', actorUserId: r.values.createdBy, origin: 'ticket_promotion', sourceTicketId: r.values.sourceTicketId, contentHash: hash, createdAt: created })
    } else {
      events.push({ orgId, articleId: id, type: 'created', actorUserId: r.values.createdBy, origin: r.meta.source === 'manual' ? 'manual' : r.meta.source === 'github' || r.meta.source === 'notion' ? 'sync' : 'import', contentHash: hash, createdAt: created })
    }
  }
  for (const key of ['install', 'flash', 'servo-cal', 'pid']) {
    const a = KB_ARTICLES.find((x) => x.key === key)!
    events.push({ orgId, articleId: idByKey.get(key)!, type: 'edited', actorUserId: userId('elena.rossi@example.com'), origin: 'manual', contentHash: contentHash(a.question, `${a.answer} `), createdAt: iso(now - rand(3, 14) * DAY) })
  }
  await db.insert(s.kbArticleEvents).values(events)

  // Usage: how many answers each article supported per day. Popular articles
  // get far more traffic, and use grows with the community.
  const usageRows: Array<typeof s.kbArticleUsage.$inferInsert> = []
  const todayStart = Math.floor(now / DAY) * DAY
  KB_ARTICLES.forEach((a, i) => {
    const popularity = 9 / (1 + i * 0.55)
    for (let d = 29; d >= 0; d--) {
      const dayMs = todayStart - d * DAY
      const weekend = [0, 6].includes(new Date(dayMs).getUTCDay())
      const answers = Math.round(popularity * (weekend ? 0.4 : 1) * (0.7 + 0.5 * ((29 - d) / 29)) * rand(0.5, 1.4))
      if (answers > 0) usageRows.push({ articleId: idByKey.get(a.key)!, orgId, day: new Date(dayMs).toISOString().slice(0, 10), answers })
    }
  })
  await db.insert(s.kbArticleUsage).values(usageRows)

  // ---- FAQ snapshots ------------------------------------------------------
  const faqRows = [0, 1, 2, 3].map((w) => {
    const end = todayStart - w * 7 * DAY
    const startMs = end - 7 * DAY
    const entries = FAQ_ENTRIES.slice((w * 2) % FAQ_ENTRIES.length).concat(FAQ_ENTRIES).slice(0, 5)
    return {
      orgId,
      weekStart: new Date(startMs).toISOString().slice(0, 10),
      weekEnd: new Date(end - DAY).toISOString().slice(0, 10),
      ticketCount: randInt(14, 24),
      generatedAt: iso(end + 2 * HOUR),
      // The FAQ page shows this text as-is (no markdown rendering), so keep it plain.
      content: `Frequently asked this week\n\n${entries.map(([q, a], i) => `${i + 1}. ${q}\n${a}\n`).join('\n')}`,
    }
  })
  await db.insert(s.faqSnapshots).values(faqRows)

  // ---- Widget leads, API keys and usage -----------------------------------
  const [orgRow] = await db.select({ widgetToken: s.orgs.widgetToken }).from(s.orgs).where(eq(s.orgs.id, orgId))
  const leadNames = ['ayesha.khan', 'ben.hartley', 'carmen.ortiz', 'daniel.wu', 'elif.demir', 'felix.berg', 'gita.nair', 'hugo.laurent', 'ines.costa', 'jonas.keller', 'kira.sato', 'liam.obrien']
  await db.insert(s.widgetLeads).values(leadNames.map((n, i) => ({ orgId, widgetToken: orgRow.widgetToken!, email: `${n}@example.com`, createdAt: iso(now - (i * 2.3 + 0.4) * DAY) })))

  const keyA = generateApiKey()
  const keyB = generateApiKey()
  const keys = await db
    .insert(s.apiKeys)
    .values([
      { orgId, keyHash: keyA.hash, keyPrefix: keyA.prefix, name: 'Docs site assistant', createdAt: iso(now - 40 * DAY), lastUsedAt: iso(now - 20 * MINUTE) },
      { orgId, keyHash: keyB.hash, keyPrefix: keyB.prefix, name: 'Release notes bot', scopes: ['kb:read', 'faq:read'], createdAt: iso(now - 18 * DAY), lastUsedAt: iso(now - 2 * DAY) },
    ])
    .returning({ id: s.apiKeys.id })
  const monthStart = new Date(now)
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const genRows: Array<typeof s.apiGenerations.$inferInsert> = []
  const elapsed = Math.max(DAY, now - monthStart.getTime())
  for (let i = 0; i < 260; i++) {
    genRows.push({ orgId, keyId: keys[i % 5 === 0 ? 1 : 0].id, highConfidence: chance(0.72) ? 1 : 0, createdAt: iso(monthStart.getTime() + rng() * elapsed) })
  }
  await db.insert(s.apiGenerations).values(genRows)

  // ---- Product feedback board (shared board; rows belong to the demo workspace)
  const fb = [
    { body: 'Would love a weekly digest email that lists the questions the assistant could not answer.', status: 'approved', replyTag: 'planned', replyBody: 'Thanks, this is on the plan for next quarter.' },
    { body: 'The knowledge gaps page is exactly what we needed to decide what to document next.', status: 'approved', replyTag: 'great_feedback', replyBody: 'That is great to hear, thank you!' },
    { body: 'Can ticket search filter by platform and by who answered?', status: 'approved', replyTag: 'considering', replyBody: null },
    { body: 'Dark mode for the dashboard please, we triage late in the evening.', status: 'approved', replyTag: null, replyBody: null },
    { body: 'Add the ability to bulk-approve drafts that are above a confidence threshold.', status: 'approved', replyTag: 'shipped', replyBody: 'Shipped last week. Look for the bulk actions bar on the tickets list.' },
    { body: 'Export the satisfaction ratings to CSV for our monthly report.', status: 'pending', replyTag: null, replyBody: null },
  ]
  await db.insert(s.productFeedback).values(
    fb.map((f, i) => ({
      orgId,
      userId: i === 5 ? ownerId : null,
      authorLabel: i % 2 === 0 ? 'Northwind Robotics user feedback' : 'Anonymous feedback',
      body: f.body,
      anonymous: i % 2 === 0 ? 0 : 1,
      status: f.status,
      approvedAt: f.status === 'approved' ? iso(now - (i * 3 + 2) * DAY) : null,
      replyBody: f.replyBody,
      replyTag: f.replyTag,
      repliedAt: f.replyBody ? iso(now - (i * 3 + 1) * DAY) : null,
      createdAt: iso(now - (i * 3 + 3) * DAY),
    }))
  )
  await db.insert(s.productUpdates).values([
    { title: 'Bulk actions on the tickets list', body: 'Select several tickets to approve drafts, change status or assign a priority in one step.', createdBy: ownerId, publishedAt: iso(now - 6 * DAY), createdAt: iso(now - 6 * DAY) },
    { title: 'Knowledge gaps now group repeated questions', body: 'Questions asked several times in different words show up as one row with a count.', createdBy: ownerId, publishedAt: iso(now - 20 * DAY), createdAt: iso(now - 20 * DAY) },
  ])

  // ---- Summary ------------------------------------------------------------
  const [counts] = (await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM tickets WHERE org_id = ${orgId}) AS tickets,
      (SELECT COUNT(*)::int FROM ai_assessments a JOIN tickets t ON t.id = a.ticket_id WHERE t.org_id = ${orgId} AND a.auto_deflected = 1) AS deflected,
      (SELECT COUNT(*)::int FROM kb_articles WHERE org_id = ${orgId}) AS articles,
      (SELECT COUNT(*)::int FROM csat_ratings WHERE org_id = ${orgId}) AS ratings
  `)) as unknown as Array<Record<string, number>>
  console.log(`[docs-demo] done: org ${orgId}, ${counts.tickets} tickets (${counts.deflected} auto-deflected), ${counts.articles} articles, ${counts.ratings} ratings`)
  console.log(`[docs-demo] sign in as ${DEMO_OWNER_EMAIL} with: pnpm docs:session`)
  process.exit(0)
}

main().catch((err) => {
  // Driver errors embed the whole failing statement; show the database's own message instead.
  const cause = (err as { cause?: { message?: string } } | null)?.cause?.message
  console.error(cause ?? (err instanceof Error ? err.message.slice(0, 500) : err))
  process.exit(1)
})
