import Image from 'next/image'

/**
 * The round logo at the top of the welcome card. It shows the answerLoops mark
 * unless a workspace logo is passed in, so a later logo upload can feed it
 * without any change to the card's layout. Only a path on this site or an
 * https address is ever drawn; anything else falls back to the default mark.
 */

const DEFAULT_LOGO = '/logo.png'

function usableLogo(src: string | null | undefined): src is string {
  if (!src) return false
  return (src.startsWith('/') && !src.startsWith('//')) || src.startsWith('https://')
}

export function WelcomeAvatar({ logoUrl = null, size = 48 }: { logoUrl?: string | null; size?: number }) {
  const custom = usableLogo(logoUrl)
  const mark = Math.round(size * 0.58)
  return (
    <div
      className="mx-auto flex items-center justify-center overflow-hidden rounded-full bg-brand-100 ring-4 ring-white"
      style={{ width: size, height: size }}
      data-testid="welcome-avatar"
    >
      <Image
        src={custom ? logoUrl : DEFAULT_LOGO}
        alt=""
        width={custom ? size : mark}
        height={custom ? size : mark}
        className={custom ? 'h-full w-full object-cover' : 'object-contain'}
        unoptimized={custom}
      />
    </div>
  )
}
