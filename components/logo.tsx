import Image from 'next/image'

interface LogoMarkProps {
  size?: number
  className?: string
}

// Small icon-only mark — brand gradient is baked into the source image, so
// this renders identically on light or dark surfaces (unlike a currentColor SVG).
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
