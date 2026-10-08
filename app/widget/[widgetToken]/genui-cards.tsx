'use client'

import { createContext, useContext, useState } from 'react'
import {
  safeContactHref,
  safeHttpsUrl,
  type CalloutData,
  type ChoicesData,
  type ContactData,
  type LinkCardData,
  type StepsData,
} from '@/lib/widget/genui'

/**
 * Prebuilt rich cards for the widget assistant.
 *
 * Each card is a plain presentational component fed already-validated data
 * (see lib/widget/genui.ts). Nothing here interprets model output as markup:
 * text goes in as React text nodes, and the only hrefs are ones rebuilt through
 * safeHttpsUrl / safeContactHref at render time, so even a payload that slipped
 * past the server guard can't produce a javascript: or credentialed link.
 */

interface WidgetActions {
  /** Sends `text` as the visitor's next message. */
  send: (text: string) => void
  /** False while a reply is streaming, so a tap can't interleave two runs. */
  canReply: boolean
}

const WidgetActionsContext = createContext<WidgetActions>({ send: () => {}, canReply: false })
export const WidgetActionsProvider = WidgetActionsContext.Provider

const cardBase = 'w-full max-w-[88%] rounded-2xl rounded-bl-sm border border-gray-100 bg-white shadow-sm'

export function CardSkeleton() {
  return (
    <div className={`${cardBase} space-y-2 p-3`} aria-hidden="true">
      <div className="h-2.5 w-1/3 animate-pulse rounded bg-gray-100" />
      <div className="h-2 w-full animate-pulse rounded bg-gray-100" />
      <div className="h-2 w-4/5 animate-pulse rounded bg-gray-100" />
    </div>
  )
}

export function StepsCard({ data }: { data: StepsData }) {
  return (
    <section className={`${cardBase} p-3`} aria-label={data.title}>
      <h3 className="mb-2.5 break-words text-xs font-semibold text-gray-900">{data.title}</h3>
      <ol className="space-y-0">
        {data.steps.map((step, i) => {
          const isLast = i === data.steps.length - 1
          return (
            <li key={i} className="flex gap-2.5">
              <div className="flex flex-col items-center">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[0.625rem] font-semibold text-white">
                  {i + 1}
                </span>
                {!isLast && <span className="my-0.5 w-px flex-1 bg-brand-100" />}
              </div>
              <div className={`min-w-0 flex-1 ${isLast ? '' : 'pb-3'}`}>
                <p className="break-words text-xs font-medium leading-5 text-gray-900">{step.title}</p>
                {step.detail && <p className="mt-0.5 break-words text-xs leading-relaxed text-gray-500">{step.detail}</p>}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export function ChoicesCard({ data }: { data: ChoicesData }) {
  const { send, canReply } = useContext(WidgetActionsContext)
  const [picked, setPicked] = useState<string | null>(null)
  const locked = picked !== null || !canReply

  return (
    <section className={`${cardBase} p-3`} aria-label={data.prompt}>
      <p className="mb-2 break-words text-xs font-medium text-gray-900">{data.prompt}</p>
      <div className="flex flex-wrap gap-1.5">
        {data.options.map((option) => {
          const selected = picked === option.label
          return (
            <button
              key={option.label}
              type="button"
              disabled={locked}
              onClick={() => {
                setPicked(option.label)
                send(option.label)
              }}
              className={`max-w-full break-words rounded-2xl border px-3 py-1.5 text-left text-xs font-medium transition-colors ${
                selected
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-brand-200 bg-brand-50 text-brand-700 hover:border-brand-300 hover:bg-brand-100 disabled:opacity-50 disabled:hover:bg-brand-50'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}

const CALLOUT_TONES = {
  info: {
    wrap: 'border-blue-100 bg-blue-50',
    icon: 'text-blue-500',
    title: 'text-blue-900',
    body: 'text-blue-800',
    path: 'M12 8v.01M12 11v5m9-4a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  warning: {
    wrap: 'border-amber-100 bg-amber-50',
    icon: 'text-amber-500',
    title: 'text-amber-900',
    body: 'text-amber-800',
    path: 'M12 9v4m0 4h.01M10.3 3.9L2.4 17.5A2 2 0 004.1 20.5h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  },
  success: {
    wrap: 'border-green-100 bg-green-50',
    icon: 'text-green-500',
    title: 'text-green-900',
    body: 'text-green-800',
    path: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
} as const

export function CalloutCard({ data }: { data: CalloutData }) {
  const tone = CALLOUT_TONES[data.tone]
  return (
    <aside className={`flex w-full max-w-[88%] gap-2.5 rounded-2xl rounded-bl-sm border p-3 ${tone.wrap}`}>
      <svg
        className={`mt-0.5 h-4 w-4 shrink-0 ${tone.icon}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={tone.path} />
      </svg>
      <div className="min-w-0">
        <p className={`break-words text-xs font-semibold ${tone.title}`}>{data.title}</p>
        <p className={`mt-0.5 break-words text-xs leading-relaxed ${tone.body}`}>{data.body}</p>
      </div>
    </aside>
  )
}

export function LinkCard({ data }: { data: LinkCardData }) {
  const href = safeHttpsUrl(data.url)
  if (!href) return null
  const host = new URL(href).hostname.replace(/^www\./, '')
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${cardBase} group block p-3 transition-colors hover:border-brand-200 hover:bg-brand-50/40`}
    >
      <p className="truncate text-[0.625rem] text-gray-400">{host}</p>
      <p className="mt-0.5 break-words text-xs font-semibold text-gray-900">{data.title}</p>
      {data.description && <p className="mt-0.5 break-words text-xs leading-relaxed text-gray-500">{data.description}</p>}
      <span className="mt-2 inline-flex max-w-full items-center gap-1 text-xs font-medium text-brand-600 group-hover:text-brand-700">
        <span className="min-w-0 break-words">{data.cta || 'Open'}</span>
        <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M9 7h8v8" />
        </svg>
      </span>
    </a>
  )
}

const CONTACT_ICON_PATHS = {
  email: 'M3 8l9 6 9-6M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z',
  phone: 'M3 5a2 2 0 012-2h2.2a1 1 0 01.95.68l1.1 3.3a1 1 0 01-.5 1.2l-1.6.8a11 11 0 005.3 5.3l.8-1.6a1 1 0 011.2-.5l3.3 1.1a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C9.7 21 3 14.3 3 6V5z',
  url: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1m-2 8a4 4 0 01-5.7 0 4 4 0 010-5.7l3-3',
} as const

export function ContactCard({ data }: { data: ContactData }) {
  const options = data.options.flatMap((o) => {
    const href = safeContactHref(o.kind, o.value)
    return href ? [{ ...o, href }] : []
  })
  if (options.length === 0) return null
  return (
    <section className={`${cardBase} p-3`} aria-label="Contact options">
      <p className="mb-2 break-words text-xs text-gray-700">{data.message}</p>
      <ul className="space-y-1.5">
        {options.map((o) => (
          <li key={`${o.kind}:${o.value}`}>
            <a
              href={o.href}
              {...(o.kind === 'url' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="flex items-center gap-2.5 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 transition-colors hover:border-brand-200 hover:bg-brand-50"
            >
              <svg
                className="h-3.5 w-3.5 shrink-0 text-brand-600"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={CONTACT_ICON_PATHS[o.kind]} />
              </svg>
              <span className="min-w-0">
                <span className="block break-words text-xs font-medium text-gray-900">{o.label}</span>
                <span className="block break-all text-[0.625rem] text-gray-400">{o.value}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
