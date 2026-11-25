'use client'

import { useState } from 'react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import type { FAQSnapshot } from '@/types'
import { Page, PageHeader } from '@/components/dashboard/page-shell'

export default function FAQPage() {
  const [faq, setFaq] = useState<FAQSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    fetch('/api/faq')
      .then((r) => r.json())
      .then((data) => {
        setFaq(data.content ? data : null)
        setLoading(false)
      })
  }, [])

  async function regenerate() {
    setGenerating(true)
    try {
      const res = await fetch('/api/faq/generate', { method: 'POST' })
      if (res.ok) {
        const refreshed = await fetch('/api/faq').then((r) => r.json())
        setFaq(refreshed.content ? refreshed : null)
      }
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title="FAQ"
        description={faq ? `Generated ${new Date(faq.generated_at).toLocaleDateString()} · ${faq.ticket_count} tickets` : undefined}
        actions={
          <Button onClick={regenerate} disabled={generating} variant="secondary" size="sm">
            {generating ? 'Generating…' : 'Regenerate FAQ'}
          </Button>
        }
      />

      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {!loading && !faq && (
        <div className="bg-white rounded-lg border border-gray-200 px-6 py-12 text-center">
          <p className="text-sm text-gray-500 mb-3">No FAQ generated yet.</p>
          <Button onClick={regenerate} disabled={generating} size="sm">
            {generating ? 'Generating…' : 'Generate from this week\'s tickets'}
          </Button>
        </div>
      )}

      {faq?.content && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 prose prose-sm max-w-none sm:p-8">
          <pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans leading-relaxed">{faq.content}</pre>
        </div>
      )}
    </Page>
  )
}
