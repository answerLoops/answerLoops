import { LogoMark } from '@/components/logo'

function ChannelIcon({ kind }: { kind: 'discord' | 'github' | 'slack' | 'email' }) {
  if (kind === 'github') {
    return <span className="text-white/80">◉</span>
  }
  if (kind === 'email') {
    return <span className="text-cyan-200">✉</span>
  }
  if (kind === 'slack') {
    return <span className="font-bold text-[#36c5f0]">✣</span>
  }
  return <span className="font-bold text-[#8b91ff]">◌</span>
}

function Arrow({ direction = 'right' }: { direction?: 'right' | 'down' }) {
  return (
    <span aria-hidden="true" className={direction === 'down' ? 'text-blue-300/70' : 'text-blue-300/70'}>
      {direction === 'down' ? '↓' : '→'}
    </span>
  )
}

function SourceCard({ kind, label, detail }: { kind: 'discord' | 'github' | 'slack' | 'email'; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.055] px-3.5 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.16)]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-sm">
        <ChannelIcon kind={kind} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-white/85">{label}</span>
        <span className="mt-0.5 block truncate text-[0.625rem] text-white/35">{detail}</span>
      </span>
    </div>
  )
}

function ProcessCard({ eyebrow, title, detail, accent }: { eyebrow: string; title: string; detail: string; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0d172b] p-4 shadow-[0_14px_38px_rgba(0,0,0,0.2)]">
      <div className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${accent}`} />
      <p className="text-[0.5625rem] font-semibold uppercase tracking-[0.16em] text-white/35">{eyebrow}</p>
      <p className="mt-2 text-sm font-semibold text-white/90">{title}</p>
      <p className="mt-1 text-[0.625rem] leading-relaxed text-white/40">{detail}</p>
    </div>
  )
}

export function WorkflowDiagram() {
  return (
    <figure
      className="relative overflow-hidden rounded-[1.75rem] border border-blue-300/10 bg-[#071126] p-4 shadow-[0_30px_90px_rgba(2,6,23,0.45)] sm:p-7"
      aria-labelledby="workflow-diagram-title"
    >
      <figcaption id="workflow-diagram-title" className="sr-only">AnswerLoops workflow: questions from community channels become tickets, are grounded in knowledge, pass a confidence review, then are automatically answered or sent to a human. Resolved answers improve the knowledge base.</figcaption>
      <div className="pointer-events-none absolute -left-28 -top-32 h-80 w-80 rounded-full bg-blue-600/20 blur-[110px]" />
      <div className="pointer-events-none absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-cyan-400/10 blur-[110px]" />
      <div className="landing-grid pointer-events-none absolute inset-0 opacity-25" />

      <div className="relative mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-5">
        <div className="flex items-center gap-2.5">
          <LogoMark size={22} />
          <div>
            <p className="text-xs font-semibold text-white/85">One support loop</p>
            <p className="mt-0.5 text-[0.625rem] text-white/35">Every channel. One knowledge layer.</p>
          </div>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-1.5 text-[0.625rem] font-medium text-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.8)]" />
          Confidence gate active
        </span>
      </div>

      <div className="relative grid gap-3 lg:grid-cols-[1fr_32px_1.15fr_32px_1fr] lg:items-center">
        <div className="space-y-2">
          <p className="mb-3 text-[0.5625rem] font-semibold uppercase tracking-[0.18em] text-blue-200/55">Where questions start</p>
          <SourceCard kind="discord" label="Discord" detail="Webhook stopped firing" />
          <SourceCard kind="github" label="GitHub" detail="Issue · #2841" />
          <SourceCard kind="slack" label="Slack" detail="How do I configure this?" />
          <SourceCard kind="email" label="Email + web chat" detail="One shared support queue" />
        </div>

        <div className="hidden items-center justify-center text-2xl lg:flex"><Arrow /></div>

        <div className="space-y-2.5">
          <p className="mb-3 text-[0.5625rem] font-semibold uppercase tracking-[0.18em] text-cyan-200/55">What AnswerLoops does</p>
          <ProcessCard eyebrow="01 · Normalize" title="One ticket model" detail="Source, thread, priority, and organization context stay attached." accent="from-indigo-400 to-blue-500" />
          <ProcessCard eyebrow="02 · Ground" title="Retrieve evidence" detail="Docs, files, repositories, and approved answers inform the draft." accent="from-blue-400 to-cyan-400" />
          <ProcessCard eyebrow="03 · Review" title="Score confidence" detail="A separate review pass decides whether the answer is safe to send." accent="from-cyan-300 to-emerald-300" />
        </div>

        <div className="hidden items-center justify-center text-2xl lg:flex"><Arrow /></div>

        <div className="space-y-2">
          <p className="mb-3 text-[0.5625rem] font-semibold uppercase tracking-[0.18em] text-emerald-200/55">How it resolves</p>
          <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/[0.07] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-100"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-300/15">✓</span> Auto-reply</div>
            <p className="mt-2 text-[0.625rem] leading-relaxed text-emerald-100/50">High-confidence answers post back where the question started.</p>
          </div>
          <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-100"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-300/10">↗</span> Human review</div>
            <p className="mt-2 text-[0.625rem] leading-relaxed text-amber-100/45">Uncertain questions arrive with context, sources, and a draft.</p>
          </div>
        </div>
      </div>

      <div className="relative mt-6 flex flex-col items-center gap-2 border-t border-white/8 pt-5 text-center sm:flex-row sm:justify-center sm:gap-4">
        <span className="rounded-full border border-blue-300/15 bg-blue-300/[0.06] px-3 py-1.5 text-[0.625rem] font-medium text-blue-100/70">Resolved answer</span>
        <span className="rotate-90 text-xl text-blue-300/70 sm:rotate-0"><Arrow /></span>
        <span className="rounded-full border border-cyan-300/15 bg-cyan-300/[0.06] px-3 py-1.5 text-[0.625rem] font-medium text-cyan-100/70">Reusable knowledge</span>
        <span className="text-[0.625rem] text-white/30">improves the next answer</span>
      </div>
    </figure>
  )
}
