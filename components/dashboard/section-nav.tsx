'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { planIncludesFeature, type Feature } from '@/lib/billing/entitlements'
import { LockBadge } from '@/components/billing/locked-feature'
import { usePlanId } from '@/components/billing/use-plan-id'

interface SectionItem {
  href: string
  label: string
  feature?: Feature
}

// Pages that live under one sidebar entry. The sidebar stays short, and these
// links move between the pages of a section. Each page keeps its own address.
const SECTIONS: { label: string; items: SectionItem[] }[] = [
  {
    label: 'Support',
    items: [
      { href: '/tickets', label: 'Tickets' },
      { href: '/leads', label: 'Leads' },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { href: '/kb', label: 'Knowledge Base' },
      { href: '/faq', label: 'FAQ' },
      { href: '/simulation', label: 'Simulation', feature: 'simulation' },
    ],
  },
]

/**
 * Links between the pages of a section (Tickets and Leads; Knowledge Base, FAQ
 * and Simulation). Shown on those list pages only, not on a single ticket.
 */
export function SectionNav() {
  const pathname = usePathname()
  const planId = usePlanId()
  const section = SECTIONS.find((s) => s.items.some((i) => i.href === pathname))
  if (!section) return null

  return (
    <nav aria-label={`${section.label} pages`} className="mb-5 flex gap-1 border-b border-slate-200">
      {section.items.map((item) => {
        const active = item.href === pathname
        const locked = !!item.feature && planId !== null && !planIncludesFeature(planId, item.feature)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={[
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition-colors',
              active
                ? 'border-[#168fa3] text-[#082e50]'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900',
            ].join(' ')}
          >
            {item.label}
            {locked && <LockBadge />}
          </Link>
        )
      })}
    </nav>
  )
}
