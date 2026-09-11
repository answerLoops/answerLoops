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
  title: 'AnswerLoops',
  description:
    'Prepare support answers from your documentation, review drafts, and choose which connected channels can send replies automatically. Hosted or self-hosted.',
  openGraph: {
    type: 'website',
    siteName: 'AnswerLoops',
    title: 'AnswerLoops — Answers from your documentation',
    description:
      'Answers from your documentation, separate AI review, and automatic replies you control. Hosted or self-hosted.',
    // Social card image comes from app/opengraph-image.tsx (1200×630) via the
    // Next file convention — it fills both openGraph and twitter automatically.
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AnswerLoops — Answers from your documentation',
    description:
      'Answers from your documentation, separate AI review, and automatic replies you control. Hosted or self-hosted.',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32', type: 'image/x-icon' },
      { url: '/icon.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: { url: '/icon.png', sizes: '512x512', type: 'image/png' },
  },
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
        {/* nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml */}
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
