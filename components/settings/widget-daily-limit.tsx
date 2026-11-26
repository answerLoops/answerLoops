'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { saveWidgetDailyLimitAction } from '@/lib/actions/widget'

/**
 * The owner's daily limit on website widget answers, in the widget section of
 * Settings. Empty means no limit of their own, so the instance's ceiling
 * applies. Owners and admins are emailed at 80% of the limit and when it is
 * reached (lib/widget/usage-limits.ts).
 */

const format = (n: number) => n.toLocaleString('en-US')

export function WidgetDailyLimitSettings({
  canManage,
  initialLimit,
  ceiling,
}: {
  canManage: boolean
  initialLimit: number | null
  ceiling: number
}) {
  const [value, setValue] = useState(initialLimit === null ? '' : String(initialLimit))
  const [saved, setSaved] = useState(initialLimit === null ? '' : String(initialLimit))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setMessage(null)
    const fd = new FormData()
    fd.set('limit', value)
    const result = await saveWidgetDailyLimitAction(null, fd)
    if (result.error) {
      setMessage(result.error)
    } else {
      const stored = result.limit === null || result.limit === undefined ? '' : String(result.limit)
      setValue(stored)
      setSaved(stored)
      setMessage('Saved.')
    }
    setSaving(false)
  }

  const current = saved === '' ? ceiling : Number(saved)

  return (
    <div className="space-y-2 border-t border-gray-100 pt-3" data-testid="widget-daily-limit">
      <div>
        <p className="text-xs font-medium text-gray-900">Daily answer limit</p>
        <p className="text-[0.6875rem] text-gray-500">
          The most questions the widget answers in a day. When it is reached, visitors are told the chat is busy
          until the next day. Owners and admins get an email at 80% and when the limit is reached. Leave it empty to
          use the maximum of {format(ceiling)}.
        </p>
      </div>
      {canManage ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={format(ceiling)}
              aria-label="Daily answer limit"
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-base text-gray-700 sm:w-32 sm:text-xs"
            />
            <Button size="sm" onClick={save} disabled={saving || value.trim() === saved}>
              {saving ? 'Saving…' : 'Save limit'}
            </Button>
          </div>
          {message && <p className="break-words text-[0.6875rem] text-gray-600">{message}</p>}
        </>
      ) : (
        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[0.6875rem] text-gray-600">
          {format(current)} answers a day. Only owners and admins can change this.
        </p>
      )}
    </div>
  )
}
