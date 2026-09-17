interface StatsCardsProps {
  total: number
  open: number
  inProgress: number
  resolved: number
  slaBreaches: number
  pendingDrafts: number
  needsReview: number
  autoDeflected: number
}

export function StatsCards({ total, open, inProgress, resolved, slaBreaches, pendingDrafts, needsReview, autoDeflected }: StatsCardsProps) {
  const deflectionRate = total > 0 ? Math.round((autoDeflected / total) * 100) : 0

  const cards = [
    {
      label: 'Auto-Answered',
      display: String(autoDeflected),
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      ),
      accent: autoDeflected > 0,
      accentClass: 'text-brand-600',
      featured: 'dark',
    },
    {
      label: 'Deflection Rate',
      display: `${deflectionRate}%`,
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>
        </svg>
      ),
      accent: deflectionRate > 0,
      accentClass: 'text-brand-600',
      featured: 'blue',
    },
    {
      label: 'Open',
      display: String(open),
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      ),
      accent: false,
    },
    {
      label: 'In Progress',
      display: String(inProgress),
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
      ),
      accent: false,
    },
    {
      label: 'Resolved',
      display: String(resolved),
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>
        </svg>
      ),
      accent: false,
    },
    {
      label: 'Needs Review',
      display: String(needsReview),
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
        </svg>
      ),
      accent: needsReview > 0,
      accentClass: 'text-amber-600',
    },
    {
      label: 'AI Drafts Pending',
      display: String(pendingDrafts),
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      ),
      accent: pendingDrafts > 0,
      accentClass: 'text-brand-600',
    },
    {
      label: 'SLA Breaches',
      display: String(slaBreaches),
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      ),
      accent: slaBreaches > 0,
      accentClass: 'text-red-600',
    },
  ]

  return (
    <div className="dashboard-stats grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((card, index) => {
        const featured = 'featured' in card ? card.featured : undefined
        const isDark = featured === 'dark'
        const isBlue = featured === 'blue'
        return (
        <div
          key={card.label}
          className={`group relative overflow-hidden rounded-2xl border p-4 transition duration-200 hover:-translate-y-0.5 ${
            isDark
              ? 'border-[#082e50] bg-[#082e50] text-white shadow-none'
              : isBlue
                ? 'border-[#c4dfe2] bg-[#dceff0] text-[#082e50] shadow-none'
                : 'border-slate-200/80 bg-white/90 shadow-[0_12px_32px_rgba(30,64,175,0.05)] hover:shadow-[0_16px_40px_rgba(30,64,175,0.09)]'
          }`}
        >
          {(isDark || isBlue) && <div className="landing-grid pointer-events-none absolute inset-0 opacity-25" />}
          <div className="relative mb-4 flex items-center justify-between">
            <p className={`text-[0.6875rem] font-semibold ${isDark || isBlue ? 'text-white/65' : 'text-slate-500'}`}>{card.label}</p>
            <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${
              isDark || isBlue
                ? 'border border-white/10 bg-white/[0.08] text-cyan-200'
                : card.accent
                  ? 'bg-blue-50 text-blue-600'
                  : 'bg-slate-100 text-slate-400'
            }`}>
              {card.icon}
            </div>
          </div>
          <p className={`relative text-3xl font-semibold tracking-[-0.045em] ${
            isDark || isBlue ? 'text-white' : card.accent && card.accentClass ? card.accentClass : 'text-slate-950'
          }`}>
            {card.display}
          </p>
          <div className={`relative mt-3 h-0.5 overflow-hidden rounded-full ${isDark || isBlue ? 'bg-white/10' : 'bg-slate-100'}`}>
            <div className={`h-full rounded-full ${index < 2 ? 'w-3/4 bg-cyan-300' : 'w-1/3 bg-blue-400/55'}`} />
          </div>
        </div>
      )})}
    </div>
  )
}
