'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Check,
  CircleAlert,
  FileText,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
} from 'lucide-react'
import { IntegrationIcon } from '@/components/marketing/integration-icon'
import { MARKETED_CHANNELS } from '@/lib/marketing/channels'

// Same steps and wording as the README overview diagram.
const STEPS = [
  {
    icon: MessageSquare,
    title: 'Question arrives',
    body: 'From your community or website chat',
  },
  {
    icon: FileText,
    title: 'Draft from your docs',
    body: 'Find relevant knowledge. Write a sourced answer.',
  },
  {
    icon: ShieldCheck,
    title: 'Check the answer',
    body: 'A second AI Agent reviews the draft against sources.',
  },
  {
    icon: Send,
    title: 'Reply with confidence',
    body: 'Your team approves, or auto-reply when enabled.',
  },
]

type Example =
  | { kind: 'question'; text: string; where: string }
  | { kind: 'sources'; sources: string[] }
  | { kind: 'note'; tone: 'ok' | 'warn'; text: string }

// One worked example per run, one line per step, so a visitor sees what each
// step produces rather than only what it is called. The second run is the
// case the docs do not cover: nothing is posted and the team is told instead.
const RUNS: { label: string; examples: Example[] }[] = [
  {
    label: 'Answered from docs',
    examples: [
      {
        kind: 'question',
        text: 'Webhook retries made duplicate orders. How do we stop it?',
        where: 'Discord · #dev-support',
      },
      { kind: 'sources', sources: ['Webhook delivery', 'Idempotency guide'] },
      { kind: 'note', tone: 'ok', text: 'Every step matches a cited source' },
      { kind: 'note', tone: 'ok', text: 'Posted with 2 cited sources' },
    ],
  },
  {
    label: 'Docs don’t cover it',
    examples: [
      {
        kind: 'question',
        text: 'Can we rotate our API key with no downtime?',
        where: 'Discourse · Support',
      },
      { kind: 'note', tone: 'warn', text: 'No article covers key rotation' },
      { kind: 'note', tone: 'warn', text: 'No source to check it against' },
      { kind: 'note', tone: 'warn', text: 'Held back and sent to your team' },
    ],
  },
]

// One stage per step, then one for the loop back into the docs.
const LOOP_STAGE = STEPS.length

function ExampleLine({ example }: { example: Example }) {
  if (example.kind === 'question') {
    return (
      <>
        <q>{example.text}</q>
        <span className="loop-example-where">{example.where}</span>
      </>
    )
  }
  if (example.kind === 'sources') {
    return (
      <ul className="loop-example-sources" aria-label="Sources used">
        {example.sources.map((source, index) => (
          <li key={source}>
            [{index + 1}] {source}
          </li>
        ))}
      </ul>
    )
  }
  const Icon = example.tone === 'ok' ? Check : CircleAlert
  return (
    <span className="loop-example-note">
      <Icon size={14} aria-hidden="true" />
      {example.text}
    </span>
  )
}

export function AnswerLoopOverview() {
  const [run, setRun] = useState(0)
  const [stage, setStage] = useState(0)
  const [paused, setPaused] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(true)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncMotion = () => setReducedMotion(preference.matches)
    const syncVisibility = () => setVisible(!document.hidden)
    syncMotion()
    syncVisibility()
    preference.addEventListener('change', syncMotion)
    document.addEventListener('visibilitychange', syncVisibility)
    return () => {
      preference.removeEventListener('change', syncMotion)
      document.removeEventListener('visibilitychange', syncVisibility)
    }
  }, [])

  useEffect(() => {
    if (paused || reducedMotion || !visible) return
    const timer = window.setTimeout(
      () => {
        if (stage === LOOP_STAGE) {
          setStage(0)
          setRun((current) => (current + 1) % RUNS.length)
          return
        }
        setStage((current) => current + 1)
      },
      stage === LOOP_STAGE ? 2600 : 2000,
    )
    return () => window.clearTimeout(timer)
  }, [stage, paused, reducedMotion, visible])

  // Without motion the diagram reads like the static README image: no
  // highlight, and every step of the chosen example is shown at once.
  const animated = !reducedMotion
  const stepState = (index: number) => {
    if (!animated) return 'static'
    if (stage === LOOP_STAGE) return index === 1 ? 'active' : 'done'
    return index === stage ? 'active' : index < stage ? 'done' : 'idle'
  }
  // A paused diagram never reaches the later steps, so it shows the whole
  // chosen example at once. Otherwise picking an example while paused would
  // only change the first card.
  const exampleShown = (index: number) => !animated || paused || index <= stage
  const examples = RUNS[run].examples

  return (
    <figure
      className="loop-overview"
      aria-labelledby="loop-overview-title"
      data-stage={animated ? stage : undefined}
      data-run={run}
    >
      <div className="loop-overview-head">
        <h2 id="loop-overview-title" className="loop-overview-title">
          Good answers start with your knowledge.
        </h2>
        <div className="loop-overview-controls">
          <div className="loop-run-picker" role="group" aria-label="Example">
            {RUNS.map((item, index) => (
              <button
                key={item.label}
                type="button"
                aria-pressed={run === index}
                onClick={() => {
                  setRun(index)
                  setStage(0)
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          {animated && (
            <button
              type="button"
              className="loop-overview-toggle"
              onClick={() => setPaused((value) => !value)}
              aria-label={
                paused ? 'Play diagram animation' : 'Pause diagram animation'
              }
            >
              {paused ? <Play size={13} /> : <Pause size={13} />}
            </button>
          )}
        </div>
      </div>

      <ol className="loop-steps">
        {STEPS.map(({ icon: Icon, title, body }, index) => (
          <li
            key={title}
            className="loop-step"
            data-final={index === STEPS.length - 1 || undefined}
            data-state={stepState(index)}
          >
            <Icon size={28} strokeWidth={1.8} aria-hidden="true" />
            <h3>{title}</h3>
            <p>{body}</p>
            <div
              className="loop-example"
              data-tone={
                examples[index].kind === 'note' ? examples[index].tone : undefined
              }
              data-shown={exampleShown(index)}
              aria-hidden={!exampleShown(index) || undefined}
            >
              <ExampleLine example={examples[index]} />
            </div>
          </li>
        ))}
      </ol>

      <div
        className="loop-return"
        data-state={animated ? (stage === LOOP_STAGE ? 'active' : 'idle') : 'static'}
      >
        <span>
          <RotateCcw size={13} aria-hidden="true" />
          Save useful resolutions as knowledge
        </span>
      </div>

      <div
        id="integrations"
        className="loop-channels scroll-mt-20"
        aria-label="Supported channels"
      >
        <p>answerLoops supports your community</p>
        <ul>
          {MARKETED_CHANNELS.map(({ name, href, color }) => (
            <li key={href}>
              <Link href={href}>
                <IntegrationIcon name={name} color={color} />
                <span>{name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  )
}
