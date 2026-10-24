import { ImageZoom } from 'fumadocs-ui/components/image-zoom'
import { getShot } from './shots'

/**
 * A captured product screenshot in a light window frame, click to enlarge.
 * `shot` is an id from lib/docs/shots.generated.json; the image, its size and
 * its alt text all come from there, so a re-capture updates every page.
 */
export function Screenshot({
  shot,
  caption,
  alt,
}: {
  shot: string
  caption?: string
  /** Overrides the generated alt text when a page uses the shot for a narrower point. */
  alt?: string
}) {
  const data = getShot(shot)
  return (
    <figure className="not-prose my-8">
      <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-md">
        <div className="flex items-center gap-1.5 border-b border-fd-border bg-fd-muted px-3 py-2" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-fd-border" />
          <span className="size-2.5 rounded-full bg-fd-border" />
          <span className="size-2.5 rounded-full bg-fd-border" />
        </div>
        <ImageZoom
          src={data.src}
          width={data.width}
          height={data.height}
          alt={alt ?? data.alt}
          sizes="(min-width: 1024px) 760px, 100vw"
          className="block h-auto w-full"
        />
      </div>
      {caption && (
        <figcaption className="mt-2 text-center text-sm text-fd-muted-foreground">{caption}</figcaption>
      )}
    </figure>
  )
}
