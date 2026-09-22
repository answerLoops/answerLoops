'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { subscribeLiveEvents } from '@/lib/live-events'

/**
 * Keeps DB-backed dashboard pages current without a fixed-interval poll.
 *
 * Primary path: the tab's shared Server-Sent Events stream (see
 * `lib/live-events`) pushes a `data_changed` event whenever a ticket or
 * notification row changes for this org. We call `router.refresh()` once in
 * response, debounced to collapse a burst of writes. While nothing changes,
 * no requests are made at all and a serverless database is free to suspend.
 *
 * This replaced a `router.refresh()` every 5 seconds, which re-ran every
 * Server Component query on the route regardless of whether anything had
 * changed — continuous database load for as long as a tab stayed open.
 *
 * The connection itself — opening it, closing it while the tab is hidden, and
 * rebuilding it when it goes stale — belongs to `lib/live-events`, which
 * shares one stream across every island on the page. `resync` means the
 * stream was just rebuilt and events may have been missed while it was down,
 * so we refresh immediately rather than debouncing.
 *
 * On top of that, a backstop `router.refresh()` bounds how long the page can
 * show stale data if the stream is healthy but its upstream LISTEN is not.
 *
 * It is a dead-man's switch rather than a poll: every refresh re-arms it, so
 * it fires only after BACKSTOP_MS of complete silence and a dashboard that is
 * receiving events never runs it. Only real events re-arm it — a keepalive
 * `ping` proves the HTTP stream is alive but says nothing about the LISTEN
 * behind it, which is the failure this guards against, and `lib/live-events`
 * forwards only the events that carry meaning.
 *
 * The window can be this wide because the server heartbeats its own LISTEN
 * connection and tears the stream down when that fails, surfacing here as a
 * `resync`. Detection is the heartbeat's job; this is the last line of defence.
 */

const BACKSTOP_MS = 10 * 60 * 1000
const DEBOUNCE_MS = 400

export function DashboardLive() {
  const router = useRouter()

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined
    let backstop: ReturnType<typeof setTimeout> | undefined

    // Re-armed after every refresh, so a tab that is receiving events never
    // reaches it. Fires only after BACKSTOP_MS of silence.
    const armBackstop = () => {
      clearTimeout(backstop)
      backstop = setTimeout(() => {
        // A hidden tab holds no stream, so there is nothing to have missed and
        // nothing to refresh; it re-arms either way so the switch survives.
        if (!document.hidden) router.refresh()
        armBackstop()
      }, BACKSTOP_MS)
    }

    const refreshNow = () => {
      router.refresh()
      armBackstop()
    }

    const unsubscribe = subscribeLiveEvents(
      ['data_changed', 'member_joined', 'resync'],
      (event) => {
        // Re-arm on receipt, not when the refresh lands. An arriving event is
        // itself proof the LISTEN is alive, and deferring the re-arm until
        // after the debounce leaves a DEBOUNCE_MS blind spot before the
        // deadline: the backstop fires, then the debounced refresh follows it
        // 400ms later, refreshing twice for one event.
        armBackstop()
        if (event === 'resync') {
          // Supersedes any debounced refresh already armed — otherwise a
          // data_changed from 400ms ago fires a second, redundant refresh.
          clearTimeout(debounce)
          refreshNow()
          return
        }
        clearTimeout(debounce)
        debounce = setTimeout(refreshNow, DEBOUNCE_MS)
      }
    )

    armBackstop()

    return () => {
      clearTimeout(debounce)
      clearTimeout(backstop)
      unsubscribe()
    }
  }, [router])

  return null
}
