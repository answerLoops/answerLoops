'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, FileText, Pause, Play, ScanLine, Sparkles } from 'lucide-react'
import { IntegrationIcon } from '@/components/marketing/integration-icon'

const STAGES = [
  'Question received',
  'Retrieving sources',
  'Drafting answer',
  'Reviewing answer',
  'Reply delivered',
]

const CHANNELS = [
  { name: 'Discord', color: '#5865f2', destination: '#integrations' },
  { name: 'Telegram', color: '#229ed9', destination: 'support chat' },
  { name: 'Circle', color: '#7c3aed', destination: 'the community' },
]

export function AnimatedChat() {
  const threadRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState(0)
  const [channelIndex, setChannelIndex] = useState(0)
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
        if (stage === STAGES.length - 1) {
          setStage(0)
          setChannelIndex((current) => (current + 1) % CHANNELS.length)
          return
        }
        setStage((current) => current + 1)
      },
      stage === 4 ? 6500 : stage === 0 ? 1800 : 3000,
    )
    return () => window.clearTimeout(timer)
  }, [stage, paused, reducedMotion, visible])

  useEffect(() => {
    if (reducedMotion || paused) return
    const thread = threadRef.current
    if (thread) thread.scrollTop = stage === 0 ? 0 : thread.scrollHeight
  }, [stage, reducedMotion, paused])

  const current = reducedMotion ? 4 : stage
  const channel = CHANNELS[channelIndex]
  return (
    <figure
      className="support-demo support-demo-hero"
      data-channel={channel.name.toLowerCase()}
      aria-label="Live answer loop: an answer agent drafts from documentation and a second agent reviews it"
    >
      <div className="support-demo-header">
        <span className="support-demo-title support-demo-channel">
          <IntegrationIcon name={channel.name} color={channel.color} />
          <span>answerLoops / {channel.name}</span>
        </span>
        <span className="support-demo-live">LIVE ANSWER LOOP</span>
      </div>
      <div className="support-demo-thread" ref={threadRef}>
        <div className="demo-question">
          <span className="demo-avatar">JD</span>
          <div>
            <div className="demo-message-meta">
              <strong>Developer</strong>
              <span>#integrations</span>
            </div>
            <p>
              Our webhook retries created duplicate orders. How do we prevent
              that without dropping events?
            </p>
          </div>
        </div>
        {current >= 1 && (
          <div className="demo-sources demo-enter">
            <FileText size={16} />
            <div>
              <span>Retrieved from the knowledge base</span>
              <div className="demo-source-chips">
                <span>Webhook delivery</span>
                <span>Idempotency guide</span>
              </div>
            </div>
          </div>
        )}
        {current >= 2 && (
          <div className="demo-answer demo-enter">
            <div className="demo-message-meta">
              <Sparkles size={17} />
              <strong>Answer agent</strong>
              <span>Draft</span>
            </div>
            <p>
              Retries can deliver the same event more than once. Use the{' '}
              <code>event_id</code> to make processing idempotent:
            </p>
            <ol>
              <li>Check whether the event was already processed.</li>
              <li>Save the order and a unique event ID in one transaction.</li>
              <li>
                For a duplicate, return success without creating another order.
              </li>
            </ol>
            <div className="demo-citations">
              Sources <span>[1] Webhook delivery</span>
              <span>[2] Idempotency guide</span>
            </div>
          </div>
        )}
        {current >= 3 && (
          <div className="demo-review demo-enter">
            <ScanLine size={18} />
            <div>
              <strong>Review agent</strong>
              <p>
                Checked retry behavior and duplicate handling against both
                sources.
              </p>
              <span>
                <Check size={13} /> Source-grounded <Check size={13} />{' '}
                Threshold met
              </span>
            </div>
          </div>
        )}
        {current >= 4 && (
          <div className="demo-delivered demo-enter">
            <Check size={15} />
            <span>Reply sent to {channel.destination}</span>
            <span>Auto-reply enabled</span>
          </div>
        )}
      </div>
      <figcaption className="support-demo-footer">
        <span>
          <span className="demo-dot" />
          {STAGES[current]}
        </span>
        {!reducedMotion && (
          <button
            type="button"
            onClick={() => setPaused((value) => !value)}
            aria-label={
              paused ? 'Play example animation' : 'Pause example animation'
            }
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}{' '}
            {paused ? 'Play' : 'Pause'}
          </button>
        )}
      </figcaption>
    </figure>
  )
}
