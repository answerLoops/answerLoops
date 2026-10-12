import { Resend } from 'resend'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { appOrigin } from '@/lib/site'
import { mintNewsletterConfirmToken } from './confirm-token'

const SUPPORT_EMAIL = 'support@answerloops.com'

/**
 * Asks an address to confirm a newsletter signup. The link goes to the
 * confirmation page, which only subscribes the address after the recipient
 * presses its button; until then nothing about the address is stored.
 */
export async function sendNewsletterConfirmRequest(email: string): Promise<void> {
  if (MOCK_EXTERNALS || !process.env.RESEND_API_KEY) return

  const fromAddress =
    process.env.RESEND_NEWSLETTER_FROM ??
    process.env.RESEND_FROM ??
    'Nathan from answerLoops <nathan@answerloops.com>'
  const base = appOrigin() ?? 'https://answerloops.com'
  const confirmUrl = `${base}/unsubscribe/confirm?token=${encodeURIComponent(mintNewsletterConfirmToken(email))}`

  await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: fromAddress,
    to: [email],
    replyTo: SUPPORT_EMAIL,
    subject: 'Confirm your answerLoops newsletter signup',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <p style="color:#6b7280;font-size:14px;margin-bottom:16px">Hey,</p>
        <p style="color:#6b7280;font-size:14px;margin-bottom:16px">
          Someone asked to add this address to the answerLoops newsletter. If that was you,
          confirm below and you'll hear from us when there's an integration guide or something
          else worth reading.
        </p>
        <p style="margin-bottom:24px">
          <a href="${confirmUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;padding:10px 18px;border-radius:6px;text-decoration:none">Confirm my signup</a>
        </p>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px">
          If this wasn't you, ignore this email and nothing will happen. The link expires in 48 hours.
        </p>
      </div>
    `,
  })
}
