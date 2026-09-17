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
  {
    name: 'Discord', color: '#5865f2', destination: '#game-support',
    author: 'Player', avatar: 'GX', room: '#game-support',
    question: 'Our co-op game starts rubber-banding when I stream. How can I reduce lag without lowering the graphics settings?',
    sources: ['Multiplayer connection guide', 'Streaming troubleshooting'],
    answer: 'Rubber-banding can come from network congestion rather than graphics settings. Check the connection first:',
    steps: [
      'Connect your gaming device by Ethernet and pause background uploads.',
      'Lower the stream upload bitrate to leave bandwidth for the game.',
      'Select a nearby game server and compare latency with streaming off and on.',
    ],
    review: 'Checked connection troubleshooting and streaming recommendations against both guides.',
  },
  {
    name: 'Telegram', color: '#229ed9', destination: 'support chat',
    author: 'Developer', avatar: 'JD', room: 'support chat',
    question: 'Our webhook retries created duplicate orders. How do we prevent that without dropping events?',
    sources: ['Webhook delivery', 'Idempotency guide'],
    answer: 'Retries can deliver the same event more than once. Use the event_id to make processing idempotent:',
    steps: [
      'Check whether the event was already processed.',
      'Save the order and a unique event ID in one transaction.',
      'For a duplicate, return success without creating another order.',
    ],
    review: 'Checked retry behavior and duplicate handling against both sources.',
  },
  {
    name: 'Circle', color: '#7c3aed', destination: 'the community',
    author: 'Artist', avatar: 'AL', room: 'Print swap',
    question: 'I’m joining the community print swap. How should I export my digital illustration so the colors and edges print correctly?',
    sources: ['Print swap submission guide', 'Artwork preparation checklist'],
    answer: 'Keep your layered original and prepare a separate print-ready export using the swap’s submission template:',
    steps: [
      'Match the template dimensions and extend the artwork into the marked bleed area.',
      'Use the printer’s requested color profile and check the soft proof before exporting.',
      'Export in the requested format, then share a preview in the print-swap space for feedback.',
    ],
    review: 'Checked export preparation and submission steps against the print-swap guides.',
  },
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
      stage === 4 ? 3500 : stage === 0 ? 1500 : 2000,
    )
    return () => window.clearTimeout(timer)
  }, [stage, channelIndex, paused, reducedMotion, visible])

  useEffect(() => {
    if (reducedMotion || paused) return
    const thread = threadRef.current
    if (thread) thread.scrollTop = stage === 0 ? 0 : thread.scrollHeight
  }, [stage, channelIndex, reducedMotion, paused])

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
      <div className="demo-channel-picker" role="group" aria-label="Example channel">
        {CHANNELS.map((item, index) => (
          <button
            key={item.name}
            type="button"
            aria-pressed={channelIndex === index}
            onClick={() => {
              setChannelIndex(index)
              setStage(0)
            }}
          >
            <IntegrationIcon name={item.name} color={item.color} />
            {item.name}
          </button>
        ))}
      </div>
      <div className="support-demo-thread" ref={threadRef}>
        <div className="demo-question">
          <span className="demo-avatar">{channel.avatar}</span>
          <div>
            <div className="demo-message-meta">
              <strong>{channel.author}</strong>
              <span>{channel.room}</span>
            </div>
            <p>{channel.question}</p>
          </div>
        </div>
        {current >= 1 && (
          <div className="demo-sources demo-enter">
            <FileText size={16} />
            <div>
              <span>Retrieved from the knowledge base</span>
              <div className="demo-source-chips">
                {channel.sources.map((source) => <span key={source}>{source}</span>)}
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
            <p>{channel.answer}</p>
            <ol>
              {channel.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <div className="demo-citations">
              Sources {channel.sources.map((source, index) => (
                <span key={source}>[{index + 1}] {source}</span>
              ))}
            </div>
          </div>
        )}
        {current >= 3 && (
          <div className="demo-review demo-enter">
            <ScanLine size={18} />
            <div>
              <strong>Review agent</strong>
              <p>{channel.review}</p>
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
