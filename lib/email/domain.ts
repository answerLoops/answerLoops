import { Resend } from 'resend'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { logger } from '@/lib/logger'

const MOD = 'email/domain'

function client() {
  return new Resend(process.env.RESEND_API_KEY)
}

export interface DomainRecordPair {
  name: string
  value: string
}

interface RegisteredDomain {
  providerDomainId: string
  dkim: DomainRecordPair | null
  returnPath: DomainRecordPair | null
  receiving: (DomainRecordPair & { priority: number }) | null
}

export type DomainVerificationStatus = 'pending' | 'verified' | 'failed'

// Resend's Domains API has no record literally named "return path" — its
// SPF record is what functions as the bounce/return-path record in Resend's
// own DNS scheme, so we surface the SPF record under our returnPath field.
function extractRecords(records: { record: string; name: string; value: string }[]): {
  dkim: DomainRecordPair | null
  returnPath: DomainRecordPair | null
  receiving: (DomainRecordPair & { priority: number }) | null
} {
  const dkimRecord = records.find((r) => r.record === 'DKIM')
  const spfRecord = records.find((r) => r.record === 'SPF')
  const receivingRecord = records.find((r) => r.record === 'Receiving') as
    | { name: string; value: string; priority?: number }
    | undefined
  return {
    dkim: dkimRecord ? { name: dkimRecord.name, value: dkimRecord.value } : null,
    returnPath: spfRecord ? { name: spfRecord.name, value: spfRecord.value } : null,
    receiving: receivingRecord
      ? { name: receivingRecord.name, value: receivingRecord.value, priority: receivingRecord.priority ?? 10 }
      : null,
  }
}

// Resend's DomainStatus has more granularity than we expose in the UI —
// collapse not_started/partially_* down to 'pending' since neither means
// the domain is usable yet.
function collapseStatus(status: string): DomainVerificationStatus {
  if (status === 'verified') return 'verified'
  if (status === 'failed') return 'failed'
  return 'pending'
}

function registrationError(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : ''

  if (message.toLowerCase().includes('registered already')) {
    return 'This domain is already registered with the email provider. Use a different domain or contact support if it belongs to your account.'
  }

  return 'Domain verification is temporarily unavailable. Please try again later.'
}

export async function registerDomain(domain: string): Promise<RegisteredDomain | { error: string }> {
  if (MOCK_EXTERNALS || !process.env.RESEND_API_KEY) {
    logger.error('Resend domain registration unavailable — platform email credentials are not configured', {
      module: MOD,
      domain,
    })
    return { error: 'Domain verification is temporarily unavailable. Please try again later.' }
  }

  const { data, error } = await client().domains.create({
    name: domain,
    capabilities: { sending: 'enabled', receiving: 'enabled' },
  })
  if (error || !data) {
    const errorMessage = registrationError(error)
    logger.error('Resend domain registration failed', {
      module: MOD,
      domain,
      error: error && typeof error === 'object'
        ? {
            name: 'name' in error ? error.name : undefined,
            message: 'message' in error ? error.message : undefined,
            statusCode: 'statusCode' in error ? error.statusCode : undefined,
          }
        : error,
    })
    return { error: errorMessage }
  }

  const { dkim, returnPath, receiving } = extractRecords(data.records ?? [])
  return { providerDomainId: data.id, dkim, returnPath, receiving }
}

export async function checkDomainStatus(
  providerDomainId: string
): Promise<{ status: DomainVerificationStatus; error?: string }> {
  if (MOCK_EXTERNALS || !process.env.RESEND_API_KEY) {
    logger.error('Resend domain status check unavailable — platform email credentials are not configured', {
      module: MOD,
      providerDomainId,
    })
    return { status: 'pending', error: 'Domain verification is temporarily unavailable. Please try again later.' }
  }

  const { data, error } = await client().domains.get(providerDomainId)
  if (error || !data) {
    logger.error('Resend domain status check failed', { module: MOD, providerDomainId, error })
    return { status: 'pending', error: 'Domain verification is temporarily unavailable. Please try again later.' }
  }

  return { status: collapseStatus(data.status) }
}

export async function removeDomain(providerDomainId: string): Promise<void> {
  if (MOCK_EXTERNALS || !process.env.RESEND_API_KEY) return

  const { error } = await client().domains.remove(providerDomainId)
  if (error) {
    logger.error('Resend domain removal failed', { module: MOD, providerDomainId, error })
  }
}
