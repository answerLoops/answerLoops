'use client'

import { useId, useState } from 'react'
import { ArrowDown, ArrowRight, CornerDownLeft } from 'lucide-react'
import { LogoMark } from '@/components/logo'
import { IntegrationLogo } from './integration-logo'

interface FlowItem {
  title: string
  text: string
}

interface FlowStep extends FlowItem {
  /** Logo key shown on this step instead of its number, e.g. the AI provider doing the drafting. */
  logo?: string
}

interface FlowOutcome extends FlowItem {
  /**
   * post = answer goes out, review = a person decides, escalate = a person is
   * pulled in, info = a neutral fact (cost, model choice) with no warning color.
   */
  tone?: 'post' | 'review' | 'escalate' | 'info'
}

const OUTCOME_STYLE = {
  post: 'border-fd-primary/30 bg-fd-card',
  review: 'border-amber-300 bg-amber-50',
  escalate: 'border-orange-300 bg-orange-50',
  info: 'border-fd-border bg-fd-card',
} as const

const OUTCOME_DOT = {
  post: 'bg-fd-primary',
  review: 'bg-amber-500',
  escalate: 'bg-orange-500',
  info: 'bg-fd-ring',
} as const

/**
 * How an integration works, as a diagram you can poke at: the platform on the
 * left, the answerLoops pipeline in the middle, what can happen to the answer
 * on the right. Click or focus any box to read what it does. The layout
 * follows the width of its own container, so it stacks inside a narrow docs
 * column and spreads out when there is room.
 */
export function IntegrationFlow({
  platform,
  source,
  trigger,
  steps,
  outcomes,
  replyLabel,
  sourceLogo,
  sourceLabel = 'Your community',
  outcomesLabel = 'What happens next',
}: {
  /** Logo key, e.g. "discourse" or "Google Chat". Also used in the labels. */
  platform: string
  /** The thing on the platform side, e.g. { title: 'Your forum', text: '...' }. */
  source: FlowItem
  /** How the platform tells answerLoops something happened (webhook, poll, ...). */
  trigger: FlowItem
  /** What answerLoops does with it, in order. */
  steps: FlowStep[]
  outcomes: FlowOutcome[]
  /** Caption on the return path, e.g. "Reply posted in the topic". */
  replyLabel: string
  /** Logo for the left tile when it is not the platform itself, e.g. "channels" on a provider page. */
  sourceLogo?: string
  /** Heading over the platform column. Knowledge sources say "Your documentation". */
  sourceLabel?: string
  /** Heading over the outcomes column. Knowledge sources say "What it powers". */
  outcomesLabel?: string
}) {
  const id = useId()
  const nodes: Record<string, FlowItem> = {
    source,
    trigger,
    ...Object.fromEntries(steps.map((s, i) => [`step-${i}`, s])),
    ...Object.fromEntries(outcomes.map((o, i) => [`out-${i}`, o])),
  }
  const [active, setActive] = useState('source')
  const current = nodes[active] ?? source

  const select = (key: string) => () => setActive(key)
  const nodeClass = (key: string, extra = '') =>
    `w-full rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring ${
      active === key
        ? 'border-fd-primary bg-fd-accent ring-2 ring-fd-primary/20'
        : 'border-fd-border hover:border-fd-primary/50'
    } ${extra}`

  return (
    <figure
      className="not-prose @container mt-2 mb-8 overflow-hidden rounded-2xl border border-fd-border bg-fd-card"
      aria-label={`How the ${platform} integration works`}
    >
      <div className="grid gap-3 p-4 @2xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.6fr)_auto_minmax(0,1.2fr)] @2xl:items-stretch @2xl:gap-2 @2xl:p-5">
        {/* Platform */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
            {sourceLabel}
          </p>
          <button
            type="button"
            aria-pressed={active === 'source'}
            onClick={select('source')}
            onFocus={select('source')}
            className={nodeClass('source', 'flex flex-1 flex-col items-start gap-3')}
          >
            <IntegrationLogo name={sourceLogo ?? platform} size={48} />
            <span className="text-sm font-semibold">{source.title}</span>
          </button>
          <button
            type="button"
            aria-pressed={active === 'trigger'}
            onClick={select('trigger')}
            onFocus={select('trigger')}
            className={nodeClass('trigger', 'text-sm')}
          >
            <span className="font-medium">{trigger.title}</span>
          </button>
        </div>

        <Arrow />

        {/* answerLoops pipeline */}
        <div className="flex flex-col gap-2 rounded-xl bg-fd-accent p-3">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
            <LogoMark size={18} />
            answerLoops
          </p>
          <ol className="flex flex-1 flex-col gap-2">
            {steps.map((step, i) => (
              <li key={step.title}>
                <button
                  type="button"
                  aria-pressed={active === `step-${i}`}
                  onClick={select(`step-${i}`)}
                  onFocus={select(`step-${i}`)}
                  className={nodeClass(`step-${i}`, 'flex items-center gap-3 bg-fd-card')}
                >
                  {step.logo ? (
                    <IntegrationLogo name={step.logo} size={28} className="rounded-lg" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fd-primary text-xs font-semibold text-fd-primary-foreground"
                    >
                      {i + 1}
                    </span>
                  )}
                  <span className="text-sm font-medium">{step.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>

        <Arrow />

        {/* Outcomes */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
            {outcomesLabel}
          </p>
          <ul className="flex flex-1 flex-col gap-2">
            {outcomes.map((outcome, i) => {
              const tone = outcome.tone ?? 'post'
              return (
                <li key={outcome.title} className="flex-1">
                  <button
                    type="button"
                    aria-pressed={active === `out-${i}`}
                    onClick={select(`out-${i}`)}
                    onFocus={select(`out-${i}`)}
                    className={`${nodeClass(`out-${i}`, 'flex h-full items-center gap-2 text-sm')} ${
                      active === `out-${i}` ? '' : OUTCOME_STYLE[tone]
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`size-2.5 shrink-0 rounded-full ${OUTCOME_DOT[tone]}`}
                    />
                    <span className="font-medium">{outcome.title}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      {/* Return path */}
      <div className="flex items-center gap-2 border-t border-dashed border-fd-border px-4 py-2 text-xs text-fd-muted-foreground @2xl:px-5">
        <CornerDownLeft className="size-4 shrink-0 text-fd-primary" aria-hidden="true" />
        <IntegrationLogo name={platform} size={20} className="rounded-md" />
        <span>{replyLabel}</span>
      </div>

      {/* Detail for whichever box is selected */}
      <figcaption
        id={`${id}-detail`}
        aria-live="polite"
        className="border-t border-fd-border bg-fd-muted/60 px-4 py-3 text-sm @2xl:px-5"
      >
        <span className="font-semibold">{current.title}.</span>{' '}
        <span className="text-fd-muted-foreground">{current.text}</span>
      </figcaption>
    </figure>
  )
}

function Arrow() {
  return (
    <div
      aria-hidden="true"
      className="flex items-center justify-center text-fd-muted-foreground @2xl:px-0"
    >
      <ArrowDown className="size-5 @2xl:hidden" />
      <ArrowRight className="size-5 @max-2xl:hidden" />
    </div>
  )
}
