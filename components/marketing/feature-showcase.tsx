import Image from 'next/image'
import Link from 'next/link'
import { getShot } from '@/components/docs/shots'

type Feature = {
  shot: string
  title: string
  body: string
  href: string
  linkLabel: string
}

// Images come from the docs screenshot registry (`pnpm docs:shots`), so the
// home page and the docs always show the same, current product UI.
const FEATURES: Feature[] = [
  {
    shot: 'ticket-detail',
    title: 'See which questions still need an answer',
    body: 'See member questions from connected channels in one inbox. Each ticket keeps the original question, replies, and any deadline together so teammates can pick up the conversation.',
    href: '/docs/product/tickets',
    linkLabel: 'How tickets work',
  },
  {
    shot: 'dashboard',
    title: 'See what’s urgent before it’s late',
    body: 'Set response and resolution targets for your team. The dashboard shows what the AI answered on its own, what still needs a person, and every ticket that has missed its target, kept apart from the rest of the queue.',
    href: '/docs/product/dashboard',
    linkLabel: 'Tour the dashboard',
  },
  {
    shot: 'knowledge-gaps',
    title: 'Find the gaps in your docs',
    body: 'See the questions the AI couldn’t answer, most-asked first, and why: it needed a person, it wasn’t confident, or no article covers it. Start the missing article from the question in one click. Available on Pro and Enterprise.',
    href: '/docs/product/knowledge-gaps',
    linkLabel: 'How knowledge gaps work',
  },
  {
    shot: 'analytics',
    title: 'See where your support is improving',
    body: 'Track how many questions AI resolves and how much time it saves your team. On Pro and Enterprise, see how customers rate the answers.',
    href: '/docs/product/analytics',
    linkLabel: 'Read about analytics',
  },
]

export function FeatureShowcase() {
  return (
    <div className="feature-showcase">
      {FEATURES.map((feature, index) => {
        const shot = getShot(feature.shot)
        return (
          <article
            key={feature.shot}
            className="feature-showcase-row"
            data-flip={index % 2 === 1 || undefined}
          >
            <div className="feature-showcase-copy">
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
              <Link href={feature.href} className="marketing-text-link">
                {feature.linkLabel}
              </Link>
            </div>
            <div className="feature-showcase-shot">
              <Image
                src={shot.src}
                width={shot.width}
                height={shot.height}
                alt={shot.alt}
                sizes="(min-width: 1024px) 800px, 100vw"
              />
            </div>
          </article>
        )
      })}
    </div>
  )
}
