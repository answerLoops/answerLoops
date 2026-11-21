import { createHmac, timingSafeEqual } from 'node:crypto'

function signature(cutoff: string, orgId: number, userId: number): Buffer {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('Authentication secret is unavailable')
  return createHmac('sha256', secret)
    .update(`dashboard-activity-v1:${orgId}:${userId}:${cutoff}`)
    .digest()
}

export function signActivityCutoff(cutoff: string, orgId: number, userId: number): string {
  return signature(cutoff, orgId, userId).toString('base64url')
}

export function verifyActivityCutoff(cutoff: string, proof: string, orgId: number, userId: number): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cutoff)) return false
  if (!/^[\w-]{43}$/.test(proof)) return false
  return timingSafeEqual(Buffer.from(proof, 'base64url'), signature(cutoff, orgId, userId))
}
