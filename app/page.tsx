import Link from 'next/link'
import type { Metadata } from 'next'
import { ORDERED_PLANS } from '@/lib/billing/plans'
import { AnimatedChat } from '@/components/animated-chat'
import { Nav, Footer, GithubIcon, GITHUB_URL } from '@/components/marketing/chrome'
import { ORGANIZATION_ID } from '@/lib/site-identity'
import { PageSchema } from '@/components/marketing/page-schema'
import { jsonLdHtml } from '@/lib/marketing/json-ld'
import { MARKETED_CHANNELS } from '@/lib/marketing/channels'
import { WorkflowDiagram } from '@/components/marketing/workflow-diagram'

export const metadata: Metadata = {
  title: 'AnswerLoops — Support that lives in your community',
  description:
    'AI support that lives in your community: answer repeat questions right in the channel — Discord, Slack, forums, GitHub, Telegram, email, and website chat — and only when the answer is confident enough to be right. Open source, self-hosted, and MCP/API-ready.',
  alternates: { canonical: '/' },
}

function ArrowIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M5 12h14m-5-5 5 5-5 5" />
    </svg>
  )
}

function CheckIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  )
}

function SparkIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3 9.8 9.8 3 12l6.8 2.2L12 21l2.2-6.8L21 12l-6.8-2.2L12 3Z" />
    </svg>
  )
}

function SectionLabel({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <div className={`mb-5 flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] ${light ? 'text-blue-300' : 'text-blue-600'}`}>
      <span className={`h-px w-6 ${light ? 'bg-blue-400/70' : 'bg-blue-500'}`} />
      {children}
    </div>
  )
}

function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-white">
      <div className="landing-grid pointer-events-none absolute inset-0 opacity-50" />
      <div className="pointer-events-none absolute left-1/2 top-[-18rem] h-[44rem] w-[72rem] -translate-x-1/2 rounded-[50%] bg-slate-100/80 blur-[140px]" />
      <div className="pointer-events-none absolute -left-48 top-[34rem] h-[34rem] w-[34rem] rounded-full bg-slate-100/70 blur-[120px]" />
      <div className="pointer-events-none absolute -right-52 top-[20rem] h-[38rem] w-[38rem] rounded-full bg-blue-50/70 blur-[130px]" />

      <div className="relative mx-auto max-w-7xl px-5 pb-20 pt-0 sm:px-8 sm:pb-28 sm:pt-0">
        <div className="mx-auto max-w-4xl text-center">
          <div className="landing-hero-rise mt-10 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-[0.6875rem] font-medium text-slate-600">
            <span className="text-brand-600"><SparkIcon /></span>
            Built for teams whose support lives in a community
          </div>

          <h1 className="landing-hero-rise [animation-delay:80ms] mt-7 text-balance text-[2.8rem] font-semibold leading-[0.98] tracking-[-0.055em] text-slate-950 sm:text-6xl md:text-[5rem]">
            Support that lives
            <span className="mt-2 block bg-gradient-to-r from-blue-400 via-cyan-300 to-indigo-400 bg-clip-text text-transparent">
              in your community.
            </span>
          </h1>

          <p className="landing-hero-rise [animation-delay:160ms] mx-auto mt-7 max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
            Your community asks the same questions every day. AnswerLoops answers them right in the channel — Discord, Slack, your forum, email — grounded in your knowledge, checked by a second model, and only when it&apos;s confident enough to be right.
          </p>

          <div className="landing-hero-rise [animation-delay:240ms] mx-auto mt-9 max-w-xl">
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              {/* One action in the fold, and it goes straight to auth. The
                  self-host link that used to sit beside this competed with it
                  at the moment of decision and sent the clicks it won out of
                  the funnel; self-hosting is still offered on the FAQ and
                  comparison pages, just not here. Sending this to /pricing
                  first asked for a plan decision before anyone was invested —
                  a small decision, since the trial is free and the plan can be
                  switched on the checkout screen, but one more thing to do
                  before signing up. */}
              <Link href="/login" className="w-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 px-6 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:brightness-110 sm:w-auto">
                Start your 14-day trial
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-medium text-slate-500">
              <span className="flex items-center gap-1.5"><CheckIcon className="h-4 w-4 text-brand-600" /> 14-day hosted trial</span>
              <span className="flex items-center gap-1.5"><CheckIcon className="h-4 w-4 text-brand-600" /> Open-source core</span>
              <span className="flex items-center gap-1.5"><CheckIcon className="h-4 w-4 text-brand-600" /> Bring your own model</span>
            </div>
          </div>
        </div>

        <div className="landing-hero-rise [animation-delay:280ms] mt-10">
          <ChannelRail />
        </div>

        <div className="landing-hero-rise [animation-delay:320ms] relative mx-auto mt-10 max-w-6xl">
          <div className="pointer-events-none absolute -inset-x-20 -bottom-24 h-56 bg-blue-600/20 blur-[100px]" />
          <div className="relative rounded-[2rem] border border-white/8 bg-white/[0.025] p-2 shadow-[0_1px_0_rgba(255,255,255,0.06)_inset] sm:p-3">
            <AnimatedChat />
          </div>
          <div className="pointer-events-none absolute inset-x-16 -bottom-px h-px bg-gradient-to-r from-transparent via-cyan-300/80 to-transparent shadow-[0_0_28px_rgba(103,232,249,0.65)]" />
        </div>
      </div>
    </section>
  )
}

// The channel rail renders the canonical marketed list — defined once in
// lib/marketing/channels.ts and shared with every other enumeration.
const CHANNELS = MARKETED_CHANNELS

function IntegrationIcon({ name, color }: { name: string; color: string }) {
  if (name === 'GitHub') {
    return <svg className="h-6 w-6" viewBox="0 0 24 24" fill={color} aria-hidden="true"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.167 6.839 9.49.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.744 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" /></svg>
  }
  if (name === 'Telegram') {
    return <svg className="h-6 w-6" viewBox="0 0 24 24" fill={color} aria-hidden="true"><path d="M21.7 3.3 18.5 20c-.24 1.18-.87 1.47-1.77.92l-4.86-3.58-2.35 2.26c-.26.26-.48.48-.98.48l.35-4.96 9.03-8.16c.39-.35-.09-.55-.6-.2L6.16 13.5 1.4 12.01c-1.04-.33-1.06-1.04.22-1.54L20.2 3.1c.88-.32 1.65.2 1.5.2Z" /></svg>
  }
  if (name === 'Email') {
    return <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>
  }
  if (name === 'Website widget') {
    return <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 7.7 7.7 0 0 1-3.2-.7L4 20l1.7-4.1A7.5 7.5 0 1 1 20 11.5Z" /><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" strokeLinecap="round" strokeWidth="2.5" /></svg>
  }
  if (name === 'Circle') {
    return <svg className="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill={color} /><path d="M15.7 8.1a5.1 5.1 0 1 0 0 7.8" fill="none" stroke="white" strokeLinecap="round" strokeWidth="2.2" /></svg>
  }
  if (name === 'Discourse') {
    return <svg className="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true"><path fill={color} d="M12 2a10 10 0 0 0-9.8 12.1L2 22l7.8-1.7A10 10 0 1 0 12 2Z" /><path fill="white" d="M8 7h4.3a4.2 4.2 0 1 1 0 8.4H8V7Zm2.1 1.9v4.6h2.2a2.3 2.3 0 1 0 0-4.6h-2.2Z" /></svg>
  }
  if (name === 'Google Chat') {
    return <svg className="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true"><path fill="#34a853" d="M4 4h9.5A6.5 6.5 0 0 1 20 10.5V15a5 5 0 0 1-5 5H9l-5 3v-5a5 5 0 0 1-3-4.5V9a5 5 0 0 1 3-5Z" /><path fill="#4285f4" d="M7 7h8a3 3 0 0 1 3 3v3H9a2 2 0 0 1-2-2V7Z" /></svg>
  }
  if (name === 'Slack') {
    return <svg className="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true"><path fill="#36c5f0" d="M9.1 2.5a2.1 2.1 0 1 0 0 4.2h2.1V4.6a2.1 2.1 0 0 0-2.1-2.1Zm0 6.3H4.6a2.1 2.1 0 1 0 0 4.2h4.5a2.1 2.1 0 1 0 0-4.2Z" /><path fill="#2eb67d" d="M21.5 9.1a2.1 2.1 0 1 0-4.2 0v2.1h2.1a2.1 2.1 0 0 0 2.1-2.1Zm-6.3 0v4.5a2.1 2.1 0 1 0 4.2 0V9.1a2.1 2.1 0 0 0-4.2 0Z" /><path fill="#ecb22e" d="M14.9 21.5a2.1 2.1 0 1 0 0-4.2h-2.1v2.1a2.1 2.1 0 0 0 2.1 2.1Zm0-6.3h4.5a2.1 2.1 0 1 0 0-4.2h-4.5a2.1 2.1 0 0 0 0 4.2Z" /><path fill="#e01e5a" d="M2.5 14.9a2.1 2.1 0 1 0 4.2 0v-2.1H4.6a2.1 2.1 0 0 0-2.1 2.1Zm6.3 0v-4.5a2.1 2.1 0 1 0-4.2 0v4.5a2.1 2.1 0 0 0 4.2 0Z" /></svg>
  }
  return <svg className="h-6 w-6" viewBox="0 0 24 24" fill={color} aria-hidden="true"><path d="M5 5.5A3.5 3.5 0 0 1 8.5 2h7A3.5 3.5 0 0 1 19 5.5v4A3.5 3.5 0 0 1 15.5 13H11l-4.5 3v-3.8A3.5 3.5 0 0 1 5 9.5v-4Z" /><path fill="white" d="M9 7.3h6v1.4H9z" /></svg>
}

function ChannelRail() {
  return (
    <section aria-label="Supported channels" className="relative">
      <div className="relative mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-6 gap-y-3 px-5 text-center sm:px-8">
        {CHANNELS.map((channel) => (
          <div key={channel.name} className="flex items-center gap-2.5 text-sm font-medium text-slate-500">
            <IntegrationIcon name={channel.name} color={channel.color} />
            {channel.name}
          </div>
        ))}
      </div>
    </section>
  )
}

function Outcomes() {
  const stats = [
    {
      eyebrow: 'Quality gate',
      value: '2-pass',
      label: 'Every answer is drafted, then independently reviewed.',
      accent: 'from-indigo-400 to-blue-400',
    },
    {
      eyebrow: 'One knowledge layer',
      value: 'Every channel',
      label: 'Discord, Slack, forums, GitHub, Telegram, email, and web share one knowledge layer.',
      accent: 'from-blue-400 to-cyan-300',
    },
    {
      eyebrow: 'Model freedom',
      value: '5+ providers',
      label: 'Use the best model for the job—or bring your own endpoint.',
      accent: 'from-cyan-300 to-emerald-300',
    },
    {
      eyebrow: 'Continuous coverage',
      value: 'Always on',
      label: 'Triage continues after your support team signs off.',
      accent: 'from-violet-400 to-blue-400',
    },
  ]

  return (
    <section className="relative overflow-hidden bg-[#f6f8fc] py-24 sm:py-32">
      <div className="pointer-events-none absolute right-[-14rem] top-[-10rem] h-[34rem] w-[34rem] rounded-full bg-blue-200/50 blur-[120px]" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
          <div className="landing-reveal">
            <SectionLabel>Built for the questions that repeat</SectionLabel>
            <h2 className="max-w-xl text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.045em] text-slate-950 sm:text-5xl">
              Turn support noise into a compounding knowledge loop.
            </h2>
          </div>
          <div className="landing-reveal [animation-delay:100ms] lg:pb-1">
            <p className="max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
              Most support tools make the inbox faster. AnswerLoops makes fewer questions reach the inbox at all. Every resolved conversation improves the next answer, while confidence gates keep your team in charge of the edge cases.
            </p>
            <Link href="/#how-it-works" className="group mt-6 inline-flex items-center gap-2 text-sm font-semibold text-blue-700">
              See the loop in action
              <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </div>

        <div className="landing-reveal relative mt-16 overflow-hidden rounded-[2rem] border border-white/10 bg-[#07101f] p-2 shadow-[0_32px_90px_rgba(15,23,42,0.18)] sm:p-3">
          <div className="landing-grid pointer-events-none absolute inset-0 opacity-30" />
          <div className="pointer-events-none absolute -right-24 -top-40 h-96 w-96 rounded-full bg-blue-500/25 blur-[110px]" />
          <div className="relative flex flex-col gap-3 border-b border-white/8 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div>
              <p className="text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-cyan-300/70">The AnswerLoops operating system</p>
              <p className="mt-1 text-sm font-medium text-white">Coverage, quality, and control—working as one loop.</p>
            </div>
            <div className="flex items-center gap-2 text-[0.625rem] text-white/45">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.8)]" />
              Built into every answer
            </div>
          </div>

          <div className="relative grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat, index) => (
              <article
                key={stat.eyebrow}
                className="group relative min-h-48 overflow-hidden rounded-[1.4rem] border border-white/[0.07] bg-white/[0.035] p-6 transition duration-300 hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/[0.055] sm:min-h-52"
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div className={`absolute inset-x-6 top-0 h-px bg-gradient-to-r ${stat.accent} opacity-80`} />
                <div className="flex items-center gap-2 text-[0.5625rem] font-semibold uppercase tracking-[0.17em] text-white/35">
                  <span className={`h-1.5 w-1.5 rounded-full bg-gradient-to-br ${stat.accent}`} />
                  {stat.eyebrow}
                </div>
                <div className="mt-8 text-[2rem] font-semibold leading-none tracking-[-0.045em] text-white sm:text-[2.25rem]">{stat.value}</div>
                <p className="mt-4 max-w-[15rem] text-xs leading-relaxed text-slate-300/55">{stat.label}</p>
                <span className="absolute bottom-5 right-5 font-mono text-[0.5625rem] text-white/15">0{index + 1}</span>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="relative overflow-hidden bg-[#050914] py-24 text-white sm:py-32">
      <div className="landing-grid pointer-events-none absolute inset-0 opacity-30" />
      <div className="pointer-events-none absolute left-[-12rem] top-1/3 h-[30rem] w-[30rem] rounded-full bg-blue-700/15 blur-[120px]" />
      <div className="relative mx-auto grid max-w-7xl gap-14 px-5 sm:px-8 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
        <div className="landing-reveal lg:sticky lg:top-28 lg:self-start">
          <SectionLabel light>The confidence-gated loop</SectionLabel>
          <h2 className="max-w-md text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.045em] sm:text-5xl">
            Autonomous when it can be. Human when it should be.
          </h2>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-slate-300/60 sm:text-base">
            The safeguard is part of the pipeline, not a setting someone remembers to turn on later.
          </p>
          <div className="mt-9 inline-flex items-center gap-3 rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-4 py-2 text-xs text-emerald-200">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Reviewer model always on
          </div>
        </div>

        <div className="landing-reveal lg:col-span-1">
          <WorkflowDiagram />
        </div>
      </div>
    </section>
  )
}

function ProductPreview() {
  return (
    <div className="relative h-full min-h-[280px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
      <div className="flex h-10 items-center gap-2 border-b border-slate-100 px-4">
        <span className="h-2 w-2 rounded-full bg-slate-200" />
        <span className="h-2 w-2 rounded-full bg-slate-200" />
        <span className="h-2 w-2 rounded-full bg-slate-200" />
        <span className="ml-3 text-[0.5625rem] font-medium text-slate-400">AnswerLoops / Analytics</span>
      </div>
      <div className="grid grid-cols-3 gap-2.5 p-4">
        {[
          ['73%', 'Deflection rate', '+8.4%'],
          ['186h', 'Time saved', '+22h'],
          ['94%', 'Answer quality', '+3.1%'],
        ].map(([value, label, delta]) => (
          <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="text-base font-semibold text-slate-900 sm:text-lg">{value}</div>
            <div className="mt-1 text-[0.5rem] text-slate-400 sm:text-[0.5625rem]">{label}</div>
            <div className="mt-2 text-[0.5rem] font-medium text-emerald-600">{delta}</div>
          </div>
        ))}
      </div>
      <div className="mx-4 rounded-xl border border-slate-100 p-4">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[0.5625rem] font-medium text-slate-500">Resolved conversations</span>
          <span className="text-[0.5rem] text-slate-300">Last 30 days</span>
        </div>
        <div className="flex h-24 items-end gap-1.5">
          {[28, 44, 38, 58, 52, 72, 63, 82, 70, 92, 84, 100].map((height, index) => (
            <span
              key={index}
              className="flex-1 rounded-t-sm bg-gradient-to-t from-blue-600 to-cyan-300"
              style={{ height: `${height}%`, opacity: 0.38 + index * 0.045 }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function Features() {
  const compactFeatures = [
    {
      title: 'Your model, your economics',
      body: 'OpenAI, Anthropic, Google, Groq, Mistral, Ollama, or any OpenAI-compatible endpoint. No hidden AI markup.',
      color: 'bg-indigo-500',
    },
    {
      title: 'Escalations arrive ready',
      body: 'Low-confidence questions reach your team with full context, cited sources, and a draft ready to edit.',
      color: 'bg-blue-500',
    },
    {
      title: 'One source of truth',
      body: 'Import what you already have — a docs site, a GitHub repo, a Notion workspace, PDFs — and let resolved tickets top it up. The same living knowledge base powers community channels, your website widget, and MCP-compatible agents.',
      color: 'bg-cyan-500',
    },
  ]

  return (
    <section id="features" className="relative overflow-hidden bg-[#eef3fb] py-24 sm:py-32">
      <div className="pointer-events-none absolute left-[-10rem] top-0 h-[30rem] w-[30rem] rounded-full bg-indigo-200/45 blur-[120px]" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <div className="landing-reveal max-w-2xl">
          <SectionLabel>Product, not a pile of integrations</SectionLabel>
          <h2 className="text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.045em] text-slate-950 sm:text-5xl">
            Everything the loop needs to keep getting better.
          </h2>
        </div>

        <div className="mt-14 grid gap-5 lg:grid-cols-2">
          <article className="landing-reveal group min-h-[500px] overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white p-6 shadow-[0_20px_60px_rgba(30,64,175,0.07)] sm:p-9">
            <div className="flex h-full flex-col">
              <div className="max-w-md">
                <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-400 text-white shadow-lg shadow-blue-500/20">
                  <SparkIcon />
                </div>
                <h3 className="text-2xl font-semibold tracking-[-0.035em] text-slate-950">Prove the impact, not just the activity.</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-500">Track deflection, answer quality, hours saved, and the topics generating the most support load.</p>
              </div>
              <div className="mt-9 flex-1 transition-transform duration-500 group-hover:-translate-y-1">
                <ProductPreview />
              </div>
            </div>
          </article>

          <article className="landing-reveal [animation-delay:100ms] group relative min-h-[500px] overflow-hidden rounded-[2rem] border border-blue-400/10 bg-[#071126] p-6 text-white shadow-[0_24px_70px_rgba(15,23,42,0.22)] sm:p-9">
            <div className="pointer-events-none absolute -right-28 top-10 h-72 w-72 rounded-full bg-blue-500/25 blur-[90px]" />
            <div className="relative flex h-full flex-col">
              <div className="max-w-md">
                <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-cyan-300">
                  <CheckIcon />
                </div>
                <h3 className="text-2xl font-semibold tracking-[-0.035em]">Quality control is built into the answer.</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-300/60">Every draft includes its evidence. Every answer passes through an independent confidence review.</p>
              </div>

              <div className="mt-10 space-y-3">
                {[
                  ['Grounding coverage', '100%', 'w-full'],
                  ['Answer completeness', '98%', 'w-[98%]'],
                  ['Reviewer confidence', '96%', 'w-[96%]'],
                ].map(([label, value, width], index) => (
                  <div key={label} className="rounded-xl border border-white/8 bg-white/[0.035] p-4">
                    <div className="mb-3 flex justify-between text-[0.625rem]">
                      <span className="text-white/45">{label}</span>
                      <span className={index === 2 ? 'font-medium text-emerald-300' : 'text-white/70'}>{value}</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-white/8">
                      <div className={`h-full ${width} rounded-full bg-gradient-to-r from-blue-500 to-cyan-300`} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-auto pt-7 text-[0.625rem] text-white/30">Auto-post threshold: 90% · configurable by category</div>
            </div>
          </article>
        </div>

        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {compactFeatures.map((feature, index) => (
            <article key={feature.title} className="landing-reveal rounded-[1.5rem] border border-slate-200/80 bg-white/75 p-7 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:bg-white hover:shadow-[0_18px_45px_rgba(30,64,175,0.08)]" style={{ animationDelay: `${index * 80}ms` }}>
              <span className={`mb-8 block h-2 w-2 rounded-full ${feature.color} shadow-[0_0_15px_currentColor]`} />
              <h3 className="text-lg font-semibold tracking-[-0.025em] text-slate-900">{feature.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-500">{feature.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function Ownership() {
  const enterprise = ['SSO and SAML', 'Audit logs', 'Custom retention', 'DPA / BAA', 'SLA-backed uptime', 'White-label widget']

  return (
    <section className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="landing-reveal relative overflow-hidden rounded-[2rem] bg-[#07101f] text-white shadow-[0_36px_100px_rgba(15,23,42,0.22)]">
          <div className="landing-grid pointer-events-none absolute inset-0 opacity-40" />
          <div className="relative grid overflow-hidden lg:grid-cols-[1.1fr_0.9fr]">
            <div className="relative border-b border-white/8 p-7 sm:p-12 lg:border-b-0 lg:border-r">
              <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-blue-500/25 blur-[100px]" />
              <div className="relative">
                <SectionLabel light>Open source by default</SectionLabel>
                <h2 className="max-w-lg text-balance text-3xl font-semibold leading-[1.08] tracking-[-0.04em] text-white sm:text-5xl">Own the experience. Own the stack.</h2>
                <p className="mt-5 max-w-lg text-sm leading-relaxed text-slate-200/85 sm:text-base">
                  Run AnswerLoops on your infrastructure when data residency and operational control matter. Or use the hosted service and let us handle the plumbing.
                </p>
                <div className="mt-8 overflow-hidden rounded-xl border border-white/15 bg-black/25 shadow-[inset_0_1px_rgba(255,255,255,0.04)]">
                  <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5" aria-hidden="true">
                    <span className="h-2 w-2 rounded-full bg-white/25" />
                    <span className="h-2 w-2 rounded-full bg-white/25" />
                    <span className="h-2 w-2 rounded-full bg-white/25" />
                  </div>
                  <div className="overflow-x-auto px-4 py-4 font-mono text-[0.6875rem] text-cyan-100 sm:text-xs">
                    <span className="mr-3 text-white/50">$</span>docker compose -f docker-compose.prod.yml up --build -d
                  </div>
                </div>
                <Link href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="group mt-7 inline-flex items-center gap-2 text-sm font-semibold text-white">
                  <GithubIcon />
                  Explore the source
                  <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </div>
            </div>

            <div className="relative p-7 sm:p-12">
              <div className="pointer-events-none absolute -bottom-24 -right-24 h-64 w-64 rounded-full bg-cyan-500/10 blur-[90px]" />
              <div className="relative inline-flex rounded-full border border-blue-300/25 bg-blue-400/[0.12] px-3 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-blue-100">Enterprise ready</div>
              <h3 className="relative mt-6 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">Control without compromise.</h3>
              <p className="relative mt-3 text-sm leading-relaxed text-slate-200/80">Security and governance for regulated teams, without losing the speed of an AI-native workflow.</p>
              <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {enterprise.map((item) => (
                  <div key={item} className="relative flex items-center gap-2.5 text-xs font-medium text-slate-200/85">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-200">
                      <CheckIcon className="h-3 w-3" />
                    </span>
                    {item}
                  </div>
                ))}
              </div>
              <Link href="/pricing" className="relative mt-9 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.11] px-5 py-2.5 text-xs font-semibold text-white shadow-[inset_0_1px_rgba(255,255,255,0.06)] transition hover:bg-white/15">
                Explore plans <ArrowIcon className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

const FAQ_ITEMS = [
  {
    q: 'What is AnswerLoops?',
    a: 'AnswerLoops is an AI support platform for teams whose users ask for help in a community instead of a support ticket. It watches Discord, Slack, Discourse and Circle forums, GitHub Issues and Discussions, Telegram, email, and your website widget (Google Chat too), answers repeat questions from your knowledge base, and routes uncertain questions to a human with a draft ready to edit.',
  },
  {
    q: 'How does it decide when to auto-answer?',
    a: 'Every draft goes through a second AI pass that grades grounding, completeness, and confidence. Only answers above your configurable threshold post automatically. Everything else enters the human queue with its sources and draft attached.',
  },
  {
    q: 'Can I use my own AI provider?',
    a: 'Yes. Configure OpenAI, Anthropic, Google Gemini, Groq, Mistral, Ollama, or any OpenAI-compatible endpoint. You pay the provider directly, with no platform markup on model usage.',
  },
  {
    q: 'Can I self-host AnswerLoops?',
    a: 'Yes. The core platform is open source and ships with a production Docker Compose setup. Self-hosting keeps community data on your infrastructure, while the hosted plans remove the operational work.',
  },
  {
    q: 'Does it work with coding agents?',
    a: 'Yes. The built-in MCP server lets compatible agents search the same knowledge base, read tickets, open new ones, and generate grounded support answers.',
  },
  {
    q: 'What if I don’t have a knowledge base yet?',
    a: 'You don’t need one to start. Connect wherever your community already asks questions — email, Discord, Slack, a Discourse or Circle forum, GitHub, Telegram, your site widget — and every incoming question becomes a ticket. Answer it once, and that answer becomes a KB article. If you do have docs, import them: crawl a docs site, sync a GitHub repo or a Notion workspace, or upload PDFs. Either way the knowledge base gets sharper with every reply.',
  },
] as const

function FAQ() {
  return (
    <section id="faq" className="relative overflow-hidden bg-[#f4f7fb] py-24 sm:py-32">
      <div className="pointer-events-none absolute -left-52 top-20 h-[34rem] w-[34rem] rounded-full bg-blue-200/45 blur-[130px]" />
      <div className="pointer-events-none absolute -right-52 bottom-0 h-[30rem] w-[30rem] rounded-full bg-cyan-100/60 blur-[120px]" />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-5 sm:px-8 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
        <div className="landing-reveal lg:sticky lg:top-28 lg:self-start">
          <SectionLabel>Questions, answered</SectionLabel>
          <h2 className="text-4xl font-semibold tracking-[-0.045em] text-slate-950 sm:text-5xl">The useful details.</h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-600">Everything you need to know before putting AnswerLoops in front of your community.</p>
          <div className="mt-7 inline-flex items-center gap-2 rounded-full border border-blue-200/80 bg-white/75 px-3 py-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.13em] text-blue-700 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            6 answers · 2 minute read
          </div>
        </div>
        <div className="space-y-3">
          {FAQ_ITEMS.map((item, index) => (
            <details
              key={item.q}
              className="landing-reveal group overflow-hidden rounded-2xl border border-slate-200/90 bg-white/80 shadow-[0_10px_35px_rgba(30,64,175,0.045)] backdrop-blur-sm transition hover:border-blue-200 hover:bg-white open:border-blue-200 open:bg-white open:shadow-[0_18px_50px_rgba(30,64,175,0.08)]"
              open={index === 0}
            >
              <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-5 text-sm font-semibold text-slate-950 marker:content-none sm:px-6 sm:text-base">
                <span className="font-mono text-[0.625rem] font-semibold text-blue-500/75">0{index + 1}</span>
                <span className="flex-1">{item.q}</span>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-lg font-light text-slate-500 transition group-open:rotate-45 group-open:border-blue-200 group-open:bg-blue-50 group-open:text-blue-600">+</span>
              </summary>
              <div className="mx-5 border-t border-slate-100 sm:mx-6">
                <p className="max-w-2xl py-5 pl-7 pr-4 text-sm leading-relaxed text-slate-600">{item.a}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

function CTA() {
  return (
    <section className="relative overflow-hidden bg-[#030611]">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[30rem] w-[54rem] -translate-x-1/2 rounded-[50%] bg-blue-600/25 blur-[120px]" />
      <div className="landing-grid pointer-events-none absolute inset-0 opacity-35" />
      <div className="relative mx-auto max-w-5xl px-5 py-24 text-center sm:px-8 sm:py-32">
        <div className="landing-reveal mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-cyan-300 shadow-[0_0_40px_rgba(59,130,246,0.18)]">
          <SparkIcon />
        </div>
        <h2 className="landing-reveal mt-7 text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.05em] text-white sm:text-6xl">Make the next repeat question the last one.</h2>
        <p className="landing-reveal mx-auto mt-5 max-w-xl text-sm leading-relaxed text-slate-300/60 sm:text-base">Connect a channel, point AnswerLoops at what your team already knows, and let it handle the questions you have answered a hundred times.</p>
        <div className="landing-reveal mx-auto mt-9 max-w-xl">
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/login" className="w-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 px-6 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:brightness-110 sm:w-auto">
              Start your 14-day trial
            </Link>
          </div>
          <p className="mt-3 text-[0.625rem] text-white/25">A card is required to start the trial. Nothing is charged for 14 days.</p>
        </div>
      </div>
    </section>
  )
}

function StructuredData() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'AnswerLoops',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: 'AI support that lives in your community — auto-answers repeat Discord, Slack, forum, GitHub, Telegram, and email questions from your knowledge base, escalating only the hard ones to a human.',
    url: 'https://answerloops.com',
    provider: { '@id': ORGANIZATION_ID },
    offers: [
      {
        '@type': 'Offer',
        name: 'Self-hosted',
        price: '0',
        priceCurrency: 'USD',
        description: 'Open source. Full source code, runs on your own infrastructure.',
      },
      ...ORDERED_PLANS.map((plan) => ({
        '@type': 'Offer',
        name: plan.name,
        price: (plan.priceMonthly / 100).toString(),
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: (plan.priceMonthly / 100).toString(),
          priceCurrency: 'USD',
          billingDuration: 'P1M',
        },
        description: plan.deflectionsPerMonth === null
          ? 'Unlimited deflections/mo, 14-day free trial'
          : `${plan.deflectionsPerMonth.toLocaleString()} deflections/mo, 14-day free trial`,
      })),
    ],
  }

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  }

  return (
    <>
      {/* nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml */}
      {/* jsonLd/faqJsonLd are built from server-controlled strings (plan names, FAQ copy), never user input; jsonLdHtml escapes `<` so the payload can't break out of the script tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(faqJsonLd) }} />
    </>
  )
}

export default function LandingPage() {
  return (
    <div className="landing-monochrome min-h-screen bg-white">
      <PageSchema name="AnswerLoops — support that lives in your community" description="AI support that lives in your community across Discord, Slack, Discourse and Circle forums, GitHub, Telegram, email, and website chat — answered in the channel, and only when confident enough to be right." path="/" />
      <StructuredData />
      <Nav />
      <main>
        <Hero />
        <Outcomes />
        <HowItWorks />
        <Features />
        <Ownership />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  )
}
