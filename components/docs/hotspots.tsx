'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { getShot, type ShotPin } from './shots'

/** Keep numbered badges from sitting on top of each other when regions share a corner. */
function placeBadges(pins: ShotPin[]): Array<{ pin: ShotPin; left: number; top: number }> {
  const placed: Array<{ pin: ShotPin; left: number; top: number }> = []
  for (const pin of pins) {
    // Badges sit on a region's top-left corner. Keep them inside the image so
    // a region that starts at the very edge does not push its badge out of view.
    let left = Math.max(pin.x, 2)
    const top = Math.max(pin.y, 3)
    while (placed.some((p) => Math.abs(p.left - left) < 3.4 && Math.abs(p.top - top) < 5)) {
      left += 3.6
    }
    placed.push({ pin, left, top })
  }
  return placed
}

/**
 * A real screenshot with numbered pins on its key regions. Hover or focus a
 * pin, or a line in the legend, and that region is spotlighted while the rest
 * dims. Region positions come from the capture run, so they follow the UI
 * when a screenshot is retaken. `notes` supplies the explanation for each pin
 * id; `only` picks and orders the pins to show.
 */
export function Hotspots({
  shot,
  notes = {},
  only,
}: {
  shot: string
  notes?: Record<string, string>
  only?: string[]
}) {
  const data = getShot(shot)
  const pins = useMemo(() => {
    const all = only ? only.map((id) => data.pins.find((p) => p.id === id)).filter((p): p is ShotPin => !!p) : data.pins
    return placeBadges(all)
  }, [data, only])
  const [active, setActive] = useState<string | null>(null)
  const activePin = pins.find((p) => p.pin.id === active)?.pin ?? null

  const on = (id: string) => () => setActive(id)
  const off = () => setActive(null)

  return (
    <figure className="not-prose my-8">
      <div className="relative overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-md">
        <Image
          src={data.src}
          width={data.width}
          height={data.height}
          alt={data.alt}
          sizes="(min-width: 1024px) 760px, 100vw"
          className="block h-auto w-full"
        />
        {activePin && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute rounded-md border-2 border-fd-ring transition-all"
            style={{
              left: `${activePin.x}%`,
              top: `${activePin.y}%`,
              width: `${activePin.w}%`,
              height: `${activePin.h}%`,
              boxShadow: '0 0 0 9999px rgb(8 46 80 / 0.4)',
            }}
          />
        )}
        {pins.map(({ pin, left, top }, i) => (
          <button
            key={pin.id}
            type="button"
            aria-label={`${i + 1}. ${pin.label}`}
            aria-pressed={active === pin.id}
            onMouseEnter={on(pin.id)}
            onMouseLeave={off}
            onFocus={on(pin.id)}
            onBlur={off}
            className="absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-fd-primary text-xs font-semibold text-fd-primary-foreground shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring max-sm:size-5 max-sm:text-[10px]"
            style={{ left: `${left}%`, top: `${top}%` }}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <ol className="mt-4 grid gap-2 @container sm:grid-cols-2">
        {pins.map(({ pin }, i) => (
          <li key={pin.id}>
            <button
              type="button"
              onMouseEnter={on(pin.id)}
              onMouseLeave={off}
              onFocus={on(pin.id)}
              onBlur={off}
              aria-pressed={active === pin.id}
              className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring ${
                active === pin.id ? 'border-fd-primary bg-fd-accent' : 'border-fd-border hover:border-fd-primary/50'
              }`}
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-fd-primary text-xs font-semibold text-fd-primary-foreground"
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{pin.label}</span>
                {notes[pin.id] && (
                  <span className="mt-0.5 block text-sm text-fd-muted-foreground">{notes[pin.id]}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </figure>
  )
}
