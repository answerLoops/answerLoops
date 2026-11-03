'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
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

// One stage per step, then one for the loop back into the docs.
const LOOP_STAGE = STEPS.length

export function AnswerLoopOverview() {
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
      () => setStage((current) => (current + 1) % (LOOP_STAGE + 1)),
      stage === LOOP_STAGE ? 2600 : 1800,
    )
    return () => window.clearTimeout(timer)
  }, [stage, paused, reducedMotion, visible])

  // Without motion the diagram reads like the static README image: no highlight.
  const animated = !reducedMotion
  const stepState = (index: number) => {
    if (!animated) return 'static'
    if (stage === LOOP_STAGE) return index === 1 ? 'active' : 'done'
    return index === stage ? 'active' : index < stage ? 'done' : 'idle'
  }

  return (
    <figure
      className="loop-overview"
      aria-labelledby="loop-overview-title"
      data-stage={animated ? stage : undefined}
    >
      <h2 id="loop-overview-title" className="loop-overview-title">
        Good answers start with your knowledge.
      </h2>
      {animated && (
        <button
          type="button"
          className="loop-overview-toggle"
          onClick={() => setPaused((value) => !value)}
          aria-label={paused ? 'Play diagram animation' : 'Pause diagram animation'}
        >
          {paused ? <Play size={13} /> : <Pause size={13} />}
        </button>
      )}

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
