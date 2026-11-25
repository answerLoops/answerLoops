// Channels answerLoops reads from but never writes back to, keyed by platform
// with the name staff see. A ticket from one of these gets an AI draft for the
// team, and the team copies the answer into the community by hand. The send
// paths (lib/channels/post-reply.ts, lib/actions/tickets.ts, lib/ai/agent.ts)
// skip these platforms, so any copy shown for them must describe saving or
// copying, never posting.
const INGEST_ONLY_PLATFORMS: Readonly<Record<string, string>> = { circle: 'Circle' }

/** The display name of an ingest-only platform, or null for a platform answerLoops can reply on. */
export function ingestOnlyPlatformName(platform: string | null | undefined): string | null {
  if (!platform || !Object.hasOwn(INGEST_ONLY_PLATFORMS, platform)) return null
  return INGEST_ONLY_PLATFORMS[platform]
}

export function isIngestOnlyPlatform(platform: string | null | undefined): boolean {
  return ingestOnlyPlatformName(platform) !== null
}
