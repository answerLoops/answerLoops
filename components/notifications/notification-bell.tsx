'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { markAllNotificationsReadAction } from '@/lib/actions/notifications'
import type { Notification } from '@/types'

type Item = Notification & { ticket_number: number | null }

function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [unread, setUnread] = useState(unreadCount)
  const [seenCount, setSeenCount] = useState(unreadCount)
  const [reload, setReload] = useState(0)
  const wrapper = useRef<HTMLDivElement>(null)

  // The server's count wins whenever the dashboard refreshes underneath us.
  if (seenCount !== unreadCount) {
    setSeenCount(unreadCount)
    setUnread(unreadCount)
  }

  // Loads the list when the dropdown opens, again when the server's count
  // changes underneath it, and when "Try again" asks for another go.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch('/api/notifications', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.json() as Promise<{ notifications: Item[]; unread: number }>
      })
      .then((data) => {
        if (cancelled) return
        setItems(data.notifications)
        setUnread(data.unread)
        setFailed(false)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, unreadCount, reload])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function markAllRead() {
    const result = await markAllNotificationsReadAction()
    if (!result.ok) return
    setItems((prev) => prev?.map((n) => ({ ...n, read: 1 })) ?? prev)
    setUnread(0)
  }

  return (
    <div className="relative" ref={wrapper}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[0.625rem] flex items-center justify-center font-medium">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-16 z-50 rounded-lg border border-gray-200 bg-white shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-9 sm:w-96">
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
            <p className="text-xs font-medium text-gray-700">
              {unread} unread notification{unread !== 1 ? 's' : ''}
            </p>
            <button
              onClick={markAllRead}
              disabled={unread === 0}
              className="shrink-0 whitespace-nowrap text-xs font-medium text-brand-600 hover:underline disabled:cursor-default disabled:text-gray-400 disabled:no-underline"
            >
              Mark all read
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {failed ? (
              <p className="px-3 py-6 text-center text-sm text-gray-500">
                Couldn&apos;t load notifications.{' '}
                <button onClick={() => setReload((n) => n + 1)} className="text-brand-600 hover:underline">Try again</button>
              </p>
            ) : items === null ? (
              <p className="px-3 py-6 text-center text-sm text-gray-400">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-500">Nothing new yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {items.map((n) => {
                  const body = (
                    <>
                      <span className="flex items-start gap-2">
                        {n.read === 0 && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" aria-label="Unread" />}
                        <span className={`min-w-0 break-words text-sm ${n.read === 0 ? 'font-medium text-gray-900' : 'text-gray-600'}`}>
                          {n.message}
                        </span>
                      </span>
                      <span className="mt-0.5 block pl-4 text-xs text-gray-400">
                        {n.ticket_number ? `Ticket #${n.ticket_number} · ` : ''}{timeAgo(n.created_at)}
                      </span>
                    </>
                  )
                  return (
                    <li key={n.id}>
                      {n.ticket_number ? (
                        <Link href={`/tickets/${n.ticket_number}`} onClick={() => setOpen(false)} className="block px-3 py-2.5 hover:bg-gray-50">
                          {body}
                        </Link>
                      ) : (
                        <div className="px-3 py-2.5">{body}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <Link
            href="/tickets"
            onClick={() => setOpen(false)}
            className="block border-t border-gray-100 px-3 py-2 text-sm text-brand-600 hover:bg-gray-50"
          >
            View all tickets →
          </Link>
        </div>
      )}
    </div>
  )
}
