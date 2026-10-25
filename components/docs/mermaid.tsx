'use client'

import { useEffect, useId, useState } from 'react'

/**
 * A diagram written as Mermaid text (flowchart, sequence, entity-relationship)
 * and drawn in the docs palette. Mermaid is large, so it is loaded the first
 * time a diagram mounts rather than shipped with every page. If a diagram
 * fails to render, the reader gets its source in a code block instead of an
 * empty box, and the page still builds.
 */
let initialized = false

async function loadMermaid() {
  const mermaid = (await import('mermaid')).default
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: 'inherit',
      themeVariables: {
        primaryColor: '#eef7f7',
        primaryTextColor: '#082e50',
        primaryBorderColor: '#168fa3',
        lineColor: '#315e81',
        secondaryColor: '#f5f7fa',
        tertiaryColor: '#ffffff',
        noteBkgColor: '#faf4e8',
        noteTextColor: '#082e50',
        actorBkg: '#eef7f7',
        actorBorder: '#168fa3',
        actorTextColor: '#082e50',
        signalColor: '#315e81',
        signalTextColor: '#082e50',
        fontSize: '14px',
      },
    })
    initialized = true
  }
  return mermaid
}

export function Mermaid({ chart, caption }: { chart: string; caption: string }) {
  const rawId = useId()
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Mermaid uses the id in CSS selectors, and useId contains colons.
    const id = `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
    loadMermaid()
      .then((mermaid) => mermaid.render(id, chart.trim()))
      .then(({ svg: out }) => {
        if (!cancelled) setSvg(out)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [chart, rawId])

  return (
    <figure className="not-prose my-8">
      <div className="overflow-x-auto rounded-xl border border-fd-border bg-fd-card p-4">
        {failed ? (
          <pre className="whitespace-pre-wrap text-xs text-fd-muted-foreground">{chart.trim()}</pre>
        ) : svg ? (
          <div
            role="img"
            aria-label={caption}
            className="flex justify-center [&>svg]:h-auto [&>svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="min-h-32 animate-pulse rounded-lg bg-fd-muted" aria-hidden="true" />
        )}
      </div>
      <figcaption className="mt-2 text-center text-sm text-fd-muted-foreground">{caption}</figcaption>
    </figure>
  )
}
