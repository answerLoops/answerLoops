import Image from 'next/image'

interface LogoMarkProps {
  size?: number
  className?: string
}

// Transparent navy mark with an aqua center, shared across app and marketing.
export function LogoMark({ size = 32, className = '' }: LogoMarkProps) {
  return (
    <Image
      src="/icon.png"
      alt=""
      width={size}
      height={size}
      className={`object-contain ${className}`}
    />
  )
}

interface LogoProps {
  width?: number
  size?: number        // legacy — ignored when width is set
  textSize?: string    // legacy — ignored (wordmark is in the image)
  className?: string
  color?: string       // legacy — ignored
}

// Full logo image with wordmark
export function Logo({ width = 130, className = '' }: LogoProps) {
  return (
    <Image
      src="/logo.png"
      alt="answerLoops"
      width={width}
      height={width}
      className={`object-contain ${className}`}
      priority
    />
  )
}
