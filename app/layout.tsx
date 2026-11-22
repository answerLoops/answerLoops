import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { siteIdentityJsonLd } from '@/lib/site-identity'
import { jsonLdHtml } from '@/lib/marketing/json-ld'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  metadataBase: new URL('https://answerloops.com'),
  title: 'answerLoops',
  description:
    'Give members timely answers from your docs and keep questions that need your team in one place. Hosted and self-hosted options.',
  openGraph: {
    type: 'website',
    siteName: 'answerLoops',
    title: 'answerLoops — Help your community grow',
    description:
      'Give members timely answers so they can stay involved and keep coming back.',
    // Social card image comes from app/opengraph-image.png (1200×630) via the
    // Next file convention — it fills both openGraph and twitter automatically.
  },
  twitter: {
    card: 'summary_large_image',
    title: 'answerLoops — Help your community grow',
    description:
      'Give members timely answers so they can stay involved and keep coming back.',
  },
  // Icons are generated from app/favicon.ico, app/icon.png, and app/apple-icon.png.
  // File-based metadata keeps their dimensions and cache versions in sync.
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background font-sans text-foreground antialiased">
        {/* siteIdentityJsonLd is a static server-defined constant, never user input; jsonLdHtml escapes `<` so the payload can't break out of the script tag. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(siteIdentityJsonLd) }}
        />
        {children}
      </body>
    </html>
  )
}
