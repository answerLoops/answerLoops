import Link from 'next/link'

interface StatsCardsProps {
  open: number
  inProgress: number
  resolved: number
  autoDeflected: number
  deflectionRate: number
}

/**
 * The four numbers worth seeing at a glance. Counts that need a decision (past
 * the response target, drafts to approve, answers to review) live in the Needs
 * attention list instead, so they are not shown twice.
 */
export function StatsCards({ open, inProgress, resolved, autoDeflected, deflectionRate }: StatsCardsProps) {
  const cards = [
    {
      label: 'Auto-Answered',
      href: '/tickets?autoDeflected=1',
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
      href: '/analytics',
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
      href: '/tickets?status=open',
      display: String(open),
      sub: inProgress > 0 ? `${inProgress} in progress` : undefined,
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      ),
      accent: false,
    },
    {
      label: 'Resolved',
      href: '/tickets?status=resolved',
      display: String(resolved),
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>
        </svg>
      ),
      accent: false,
    },
  ]

  return (
    <div className="dashboard-stats grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((card, index) => {
        const featured = 'featured' in card ? card.featured : undefined
        const isDark = featured === 'dark'
        const isBlue = featured === 'blue'
        const className = `group relative overflow-hidden rounded-2xl border p-4 transition duration-200 hover:-translate-y-0.5 ${
            isDark
              ? 'border-[#082e50] bg-[#082e50] text-white shadow-none'
              : isBlue
                ? 'border-[#c4dfe2] bg-[#dceff0] text-[#082e50] shadow-none'
                : 'border-slate-200/80 bg-white/90 shadow-[0_12px_32px_rgba(30,64,175,0.05)] hover:shadow-[0_16px_40px_rgba(30,64,175,0.09)]'
          }`
        const content = (
          <>
            {(isDark || isBlue) && <div className="landing-grid pointer-events-none absolute inset-0 opacity-25" />}
            <div className="relative mb-4 flex items-center justify-between">
              <p className={`text-[0.6875rem] font-semibold ${isDark ? 'text-white/65' : isBlue ? 'text-[#082e50]/70' : 'text-slate-500'}`}>{card.label}</p>
              <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                isDark
                  ? 'border border-white/10 bg-white/[0.08] text-cyan-200'
                  : isBlue
                    ? 'border border-[#082e50]/10 bg-white/70 text-[#082e50]'
                    : card.accent
                    ? 'bg-blue-50 text-blue-600'
                    : 'bg-slate-100 text-slate-400'
              }`}>
                {card.icon}
              </div>
            </div>
            <p className={`relative text-3xl font-semibold tracking-[-0.045em] ${
              isDark ? 'text-white' : isBlue ? 'text-[#082e50]' : card.accent && card.accentClass ? card.accentClass : 'text-slate-950'
            }`}>
              {card.display}
            </p>
            {'sub' in card && card.sub && (
              <p className="relative mt-1 text-xs text-slate-500">{card.sub}</p>
            )}
            <div className={`relative mt-3 h-0.5 overflow-hidden rounded-full ${isDark ? 'bg-white/10' : isBlue ? 'bg-[#082e50]/10' : 'bg-slate-100'}`}>
              <div className={`h-full rounded-full ${index < 2 ? 'w-3/4 bg-cyan-300' : 'w-1/3 bg-blue-400/55'}`} />
            </div>
          </>
        )
        return (
          <Link key={card.label} href={card.href} className={className}>
            {content}
          </Link>
        )
      })}
    </div>
  )
}
