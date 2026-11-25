'use client'

import { useState } from 'react'
import Image from 'next/image'

/**
 * The round logo used in the chat: large at the top of the welcome card, small
 * in the header and beside each reply. It shows the answerLoops mark unless a
 * workspace logo is passed in. Only a path on this site or an https address is
 * ever drawn, and if the image cannot load the answerLoops mark is shown
 * instead, so a broken logo never leaves a gap.
 */

const DEFAULT_LOGO = '/logo.png'

function usableLogo(src: string | null | undefined): src is string {
  if (!src) return false
  return (src.startsWith('/') && !src.startsWith('//')) || src.startsWith('https://')
}

function RoundLogo({
  logoUrl,
  size,
  className,
  testId,
}: {
  logoUrl: string | null | undefined
  size: number
  className: string
  testId: string
}) {
  const [failed, setFailed] = useState(false)
  const custom = usableLogo(logoUrl) && !failed
  const mark = Math.round(size * 0.58)
  return (
    <div className={className} style={{ width: size, height: size }} data-testid={testId}>
      {custom ? (
        // A plain image: the logo is already small and cached, and it needs to
        // be able to report that it failed to load.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
          data-testid={`${testId}-logo`}
        />
      ) : (
        <Image src={DEFAULT_LOGO} alt="" width={mark} height={mark} className="object-contain" />
      )}
    </div>
  )
}

/** The large logo at the top of the welcome card. */
export function WelcomeAvatar({ logoUrl = null, size = 48 }: { logoUrl?: string | null; size?: number }) {
  return (
    <RoundLogo
      logoUrl={logoUrl}
      size={size}
      testId="welcome-avatar"
      className="mx-auto flex items-center justify-center overflow-hidden rounded-full bg-brand-100 ring-4 ring-white"
    />
  )
}

/** The small round logo in the chat header and beside each assistant reply. */
export function LogoAvatar({
  logoUrl = null,
  size = 24,
  className = '',
  testId = 'logo-avatar',
}: {
  logoUrl?: string | null
  size?: number
  className?: string
  testId?: string
}) {
  return (
    <RoundLogo
      logoUrl={logoUrl}
      size={size}
      testId={testId}
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 ${className}`.trim()}
    />
  )
}
