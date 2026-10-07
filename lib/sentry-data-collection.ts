import type { NodeOptions } from '@sentry/nextjs'

// Which request data the Sentry SDK is allowed to attach to an error report.
//
// Sentry 11 changed the default for an unset `dataCollection` to collect
// cookies, user info, database query data and full request/response bodies.
// This app handles customer support messages, so reports must stay limited to
// the restrictive baseline earlier SDK versions used. Keep every category off
// (or scrubbed) here and share this object between the server and edge
// runtimes so they cannot drift apart.
const SCRUBBED_HEADERS = { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] }

export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: SCRUBBED_HEADERS, response: SCRUBBED_HEADERS },
  httpBodies: [],
  urlQueryParams: SCRUBBED_HEADERS,
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  graphQL: { document: false, variables: false },
} satisfies NonNullable<NodeOptions['dataCollection']>
