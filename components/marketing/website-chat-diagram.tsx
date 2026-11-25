import { ArrowRight, MessageCircle, SendHorizontal } from 'lucide-react'

// Mirrors the "How it works" flow on the chat widget docs page. Widget answers
// have no review step or approval queue, so this must not borrow the
// draft-and-review steps from WorkflowDiagram.
const STEPS = [
  {
    title: 'A visitor asks a question on your website',
    body: 'They open the chat bubble on your site or docs. No account or sign-up needed.',
  },
  {
    title: 'answerLoops searches your articles',
    body: 'Only the knowledge-base articles you publish. Past tickets and internal notes are never used.',
  },
  {
    title: 'The answer appears in the chat right away',
    body: 'Written in the visitor’s language, with steps, links, or contact options when they help.',
  },
]

export function WebsiteChatSteps() {
  return (
    <>
      <ol className="chat-steps">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="chat-steps-number" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="chat-steps-miss">
        <strong>Not covered by your articles?</strong> The chat offers to take
        the visitor’s email so your team can follow up. On Pro and Enterprise,
        the question also lands in your Review queue so you can write the
        missing article.
      </p>
    </>
  )
}

/**
 * A static picture of the widget open on a docs page. The layout and parts
 * (header, bubbles, steps card, link card, input, footer) follow the real
 * widget in app/widget/[widgetToken]; the content uses the same demo workspace
 * as the product screenshots further down the page.
 */
export function WebsiteChatMock() {
  return (
    <figure
      className="chat-mock"
      aria-label="The answerLoops chat widget answering a visitor on a documentation site"
    >
      <div className="chat-mock-stage" aria-hidden="true">
      <div className="chat-mock-browser">
        <div className="chat-mock-bar">
          <span />
          <span />
          <span />
          <p>docs.roverkit.dev/servos/calibration</p>
        </div>
        <div className="chat-mock-page">
          <p className="chat-mock-page-title">Servo calibration</p>
          <i style={{ width: '92%' }} />
          <i style={{ width: '84%' }} />
          <i style={{ width: '88%' }} />
          <i style={{ width: '60%' }} />
          <i className="chat-mock-page-gap" style={{ width: '90%' }} />
          <i style={{ width: '76%' }} />
          <i style={{ width: '82%' }} />
        </div>
      </div>

        <div className="chat-mock-panel">
          <div className="chat-mock-head">
            <span className="chat-mock-avatar">
              <MessageCircle size={14} strokeWidth={2.2} />
            </span>
            <div>
              <p>RoverKit Support</p>
              <p className="chat-mock-online">Online</p>
            </div>
          </div>
          <div className="chat-mock-thread">
            <p className="chat-mock-visitor">
              My arm servo hits the end stop and buzzes. Can I set safe limits?
            </p>
            <p className="chat-mock-answer">
              Yes. Recalibrate the servo so it learns its real range:
            </p>
            <div className="chat-mock-card">
              <p className="chat-mock-card-title">Calibrate servo range</p>
              <ol>
                <li>
                  Run <code>rover-cli servo calibrate</code> with the arm
                  unloaded.
                </li>
                <li>The wizard finds the pulse range and saves it.</li>
                <li>Still buzzing? Shrink the range by 50µs and rerun.</li>
              </ol>
            </div>
            <div className="chat-mock-card chat-mock-link">
              <p className="chat-mock-host">docs.roverkit.dev</p>
              <p className="chat-mock-card-title">Servo calibration guide</p>
              <span>
                Open <ArrowRight size={11} strokeWidth={2.5} />
              </span>
            </div>
          </div>
          <div className="chat-mock-input">
            <span>Ask a question…</span>
            <span className="chat-mock-send">
              <SendHorizontal size={12} strokeWidth={2.4} />
            </span>
          </div>
          <p className="chat-mock-powered">Powered by answerLoops</p>
        </div>
        <span className="chat-mock-bubble">
          <MessageCircle size={20} strokeWidth={2} />
        </span>
      </div>
    </figure>
  )
}
