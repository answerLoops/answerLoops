/**
 * The answer loop as a single illustration: a question comes in, an answer is
 * drafted from the knowledge base, a second AI reviews it, and it is either
 * sent or handed to a person. Pure SVG on the brand color tokens, so it needs
 * no asset file and follows the docs palette.
 */
const STEPS = [
  { x: 20, label: 'Question', sub: 'From any channel', tone: 'muted' },
  { x: 200, label: 'Draft', sub: 'From your knowledge', tone: 'brand' },
  { x: 380, label: 'Review', sub: 'A second AI checks it', tone: 'brand' },
  { x: 560, label: 'Reply', sub: 'Sent, or sent to a person', tone: 'accent' },
] as const

const FILL = {
  muted: 'var(--color-fd-muted)',
  brand: 'var(--color-fd-accent)',
  accent: 'var(--color-fd-primary)',
} as const

export function LoopIllustration({ className }: { className?: string }) {
  return (
    <>
      <LoopDiagram className={`max-sm:hidden ${className ?? ''}`} />
      <LoopList className={`sm:hidden ${className ?? ''}`} />
    </>
  )
}

/**
 * Narrow screens get the same four steps as a list: the wide diagram's fixed
 * viewBox would shrink its 12px labels to about 5px on a phone.
 */
function LoopList({ className }: { className?: string }) {
  return (
    <div className={className}>
      <ol className="flex flex-col gap-2">
        {STEPS.map((step, i) => {
          const last = i === STEPS.length - 1
          return (
            <li
              key={step.label}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                last
                  ? 'border-transparent bg-fd-primary text-fd-primary-foreground'
                  : 'border-fd-border bg-fd-card'
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  last ? 'bg-fd-primary-foreground text-fd-primary' : 'bg-fd-primary text-fd-primary-foreground'
                }`}
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{step.label}</span>
                <span className={`block text-xs ${last ? 'opacity-80' : 'text-fd-muted-foreground'}`}>
                  {step.sub}
                </span>
              </span>
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-center text-xs text-fd-muted-foreground">
        Fixes and gaps improve the next answer
      </p>
    </div>
  )
}

function LoopDiagram({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 740 170"
      role="img"
      aria-label="A question arrives from a channel, answerLoops drafts an answer from your knowledge, a second AI reviews it, and the reply is sent or handed to a person."
      className={className}
    >
      <defs>
        <marker id="loop-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="var(--color-fd-primary)" />
        </marker>
      </defs>
      {STEPS.map((step, i) => {
        const last = i === STEPS.length - 1
        return (
          <g key={step.label}>
            <rect
              x={step.x}
              y={30}
              width={160}
              height={70}
              rx={14}
              fill={FILL[step.tone]}
              stroke="var(--color-fd-primary)"
              strokeOpacity={last ? 0 : 0.35}
            />
            <text
              x={step.x + 80}
              y={61}
              textAnchor="middle"
              fontSize={17}
              fontWeight={600}
              fill={last ? 'var(--color-fd-primary-foreground)' : 'var(--color-fd-foreground)'}
            >
              {step.label}
            </text>
            <text
              x={step.x + 80}
              y={82}
              textAnchor="middle"
              fontSize={12}
              fill={last ? 'var(--color-fd-primary-foreground)' : 'var(--color-fd-muted-foreground)'}
            >
              {step.sub}
            </text>
            {!last && (
              <line
                x1={step.x + 164}
                y1={65}
                x2={step.x + 196}
                y2={65}
                stroke="var(--color-fd-primary)"
                strokeWidth={2}
                markerEnd="url(#loop-arrow)"
              />
            )}
          </g>
        )
      })}
      {/* Feedback path: corrections flow back into the knowledge base. */}
      <path
        d="M640 106 C640 140 280 140 280 106"
        fill="none"
        stroke="var(--color-fd-primary)"
        strokeWidth={2}
        strokeDasharray="5 5"
        markerEnd="url(#loop-arrow)"
      />
      <text x={460} y={162} textAnchor="middle" fontSize={12} fill="var(--color-fd-muted-foreground)">
        Fixes and gaps improve the next answer
      </text>
    </svg>
  )
}
