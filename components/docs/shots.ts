import shotsData from '@/lib/docs/shots.generated.json'

export interface ShotPin {
  id: string
  label: string
  /** Rectangle as percentages of the image: left edge, top edge, width, height. */
  x: number
  y: number
  w: number
  h: number
}

export interface Shot {
  src: string
  width: number
  height: number
  alt: string
  pins: ShotPin[]
}

const SHOTS = shotsData as Record<string, Shot>

/** A shot written by `pnpm docs:shots`. Fails loudly at build time if the id is wrong. */
export function getShot(id: string): Shot {
  const shot = SHOTS[id]
  if (!shot) {
    throw new Error(
      `Unknown screenshot "${id}". Known shots: ${Object.keys(SHOTS).join(', ')}. Run pnpm docs:shots to regenerate.`,
    )
  }
  return shot
}
