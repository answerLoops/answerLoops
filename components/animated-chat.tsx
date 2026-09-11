'use client'

import { useState } from 'react'
import Link from 'next/link'

const STEPS = ['Question', 'Source', 'Draft', 'Review'] as const

export function AnimatedChat() {
  const [step, setStep] = useState(0)
  return (
    <div className="marketing-example" aria-label="Example support workflow">
      <div className="marketing-example-header">
        <strong>AnswerLoops / Support</strong>
        <span>Illustrative example</span>
      </div>
      <div
        className="marketing-example-tabs"
        role="group"
        aria-label="Example steps"
      >
        {STEPS.map((label, index) => (
          <button
            key={label}
            type="button"
            aria-pressed={step === index}
            aria-controls="support-example-content"
            onClick={() => setStep(index)}
          >
            {index + 1}. {label}
          </button>
        ))}
      </div>
      <div
        id="support-example-content"
        className="marketing-example-body"
        aria-live="polite"
      >
        {step === 0 && (
          <>
            <p className="marketing-eyebrow">Discord / #support</p>
            <h3>A member asks for help</h3>
            <blockquote>
              How do I add a teammate to our AnswerLoops workspace?
            </blockquote>
            <p>
              The question appears in your support queue with a link to the
              original conversation.
            </p>
            <p>Follow the steps above to see the source, draft, and review.</p>
          </>
        )}
        {step === 1 && (
          <>
            <p className="marketing-eyebrow">Knowledge base</p>
            <h3>Find the relevant instructions</h3>
            <blockquote>
              Workspace owners and admins can invite teammates from Settings.
              Enter an email address, choose a role, and send the invitation.
            </blockquote>
            <Link href="/docs/product/team" className="marketing-text-link">
              Source: Invite your team
            </Link>
            <p>
              The draft uses the instructions retrieved from your knowledge
              base.
            </p>
          </>
        )}
        {step === 2 && (
          <>
            <p className="marketing-eyebrow">Suggested reply</p>
            <h3>A draft your team can review</h3>
            <blockquote>
              Open Settings and find the Team section. Enter your teammate’s
              email, choose their role, and send the invite. You’ll need an
              owner or admin role to invite someone.
            </blockquote>
            <Link href="/docs/product/team" className="marketing-text-link">
              Read the team guide
            </Link>
            <p>Check the wording and source before approving the reply.</p>
          </>
        )}
        {step === 3 && (
          <>
            <p className="marketing-eyebrow">Reply controls</p>
            <h3>You choose when replies go out</h3>
            <p>
              A separate AI review checks the draft against its sources. With
              automatic replies off, the draft waits for your team to approve
              it.
            </p>
            <p>
              When you enable automatic replies for a channel, answers that meet
              its configured threshold can post there. Other questions remain in
              the queue for your team.
            </p>
            <Link
              href="/docs/product/ai-deflection"
              className="marketing-text-link mt-4"
            >
              Read about answer review
            </Link>
          </>
        )}
      </div>
      <div className="marketing-example-caption">
        Example content. No customer data or measured performance results.
      </div>
    </div>
  )
}
