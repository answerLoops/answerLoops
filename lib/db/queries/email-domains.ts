import { eq } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { emailDomains } from '../schema'
import type { DomainRecordPair, DomainVerificationStatus } from '@/lib/email/domain'

interface EmailDomain {
  id: number
  org_id: number
  domain: string
  provider: string
  provider_domain_id: string | null
  dkim_record_name: string | null
  dkim_record_value: string | null
  return_path_record_name: string | null
  return_path_record_value: string | null
  receiving_record_name: string | null
  receiving_record_value: string | null
  receiving_record_priority: number | null
  dmarc_suggestion: string | null
  status: DomainVerificationStatus
  last_checked_at: string | null
  verified_at: string | null
  created_at: string
  updated_at: string
}

function toEmailDomain(row: typeof emailDomains.$inferSelect): EmailDomain {
  return {
    id: row.id,
    org_id: row.orgId,
    domain: row.domain,
    provider: row.provider,
    provider_domain_id: row.providerDomainId,
    dkim_record_name: row.dkimRecordName,
    dkim_record_value: row.dkimRecordValue,
    return_path_record_name: row.returnPathRecordName,
    return_path_record_value: row.returnPathRecordValue,
    receiving_record_name: row.receivingRecordName,
    receiving_record_value: row.receivingRecordValue,
    receiving_record_priority: row.receivingRecordPriority,
    dmarc_suggestion: row.dmarcSuggestion,
    status: row.status as DomainVerificationStatus,
    last_checked_at: row.lastCheckedAt,
    verified_at: row.verifiedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

export async function getEmailDomain(orgId: number): Promise<EmailDomain | null> {
  const [row] = await getDb().select().from(emailDomains).where(eq(emailDomains.orgId, orgId)).limit(1)
  return row ? toEmailDomain(row) : null
}

export async function getEmailDomainByDomain(domain: string): Promise<EmailDomain | null> {
  const [row] = await getDb().select().from(emailDomains).where(eq(emailDomains.domain, domain.toLowerCase())).limit(1)
  return row ? toEmailDomain(row) : null
}

export async function upsertEmailDomain(input: {
  orgId: number
  domain: string
  providerDomainId: string
  dkim: DomainRecordPair | null
  returnPath: DomainRecordPair | null
  receiving?: (DomainRecordPair & { priority: number }) | null
  dmarcSuggestion?: string | null
}): Promise<EmailDomain> {
  const existing = await getEmailDomain(input.orgId)
  const values = {
    domain: input.domain,
    providerDomainId: input.providerDomainId,
    dkimRecordName: input.dkim?.name ?? null,
    dkimRecordValue: input.dkim?.value ?? null,
    returnPathRecordName: input.returnPath?.name ?? null,
    returnPathRecordValue: input.returnPath?.value ?? null,
    receivingRecordName: input.receiving?.name ?? null,
    receivingRecordValue: input.receiving?.value ?? null,
    receivingRecordPriority: input.receiving?.priority ?? null,
    dmarcSuggestion: input.dmarcSuggestion ?? null,
    status: 'pending' as const,
    updatedAt: new Date().toISOString(),
  }

  if (existing) {
    await getDb().update(emailDomains).set(values).where(eq(emailDomains.orgId, input.orgId))
    return (await getEmailDomain(input.orgId))!
  }

  const [row] = await getDb()
    .insert(emailDomains)
    .values({ orgId: input.orgId, ...values })
    .returning()
  return toEmailDomain(row)
}

export async function updateEmailDomainStatus(
  orgId: number,
  status: DomainVerificationStatus
): Promise<void> {
  const now = new Date().toISOString()
  await getDb()
    .update(emailDomains)
    .set({
      status,
      lastCheckedAt: now,
      verifiedAt: status === 'verified' ? now : undefined,
      updatedAt: now,
    })
    .where(eq(emailDomains.orgId, orgId))
}

export async function deleteEmailDomain(orgId: number): Promise<void> {
  await getDb().delete(emailDomains).where(eq(emailDomains.orgId, orgId))
}
