import { createHmac, timingSafeEqual } from 'node:crypto'

function signature(snapshot: string, orgId: number, userId: number): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('Authentication secret is unavailable')
  return createHmac('sha256', secret)
    .update(`dashboard-activity-v2:${orgId}:${userId}:${snapshot}`)
    .digest()
}

export function signActivitySnapshot(snapshot: string, orgId: number, userId: number): string {
  return signature(snapshot, orgId, userId).toString('base64url')
}

export function verifyActivitySnapshot(snapshot: string, proof: string, orgId: number, userId: number): boolean {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)\|\d+:\d+:(?:\d+(?:,\d+)*)?$/.exec(snapshot)
  if (!match || match[0] !== snapshot) return false
  const milliseconds = `${match[1].slice(0, 23)}Z`
  const date = new Date(milliseconds)
  if (Number.isNaN(date.getTime()) || date.toISOString() !== milliseconds) return false
  if (!/^[\w-]{43}$/.test(proof)) return false
  const received = Buffer.from(proof, 'base64url')
  return received.toString('base64url') === proof && timingSafeEqual(received, signature(snapshot, orgId, userId))
}
