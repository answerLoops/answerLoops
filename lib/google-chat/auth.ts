import { GoogleAuth } from 'google-auth-library'
import { logger } from '@/lib/logger'

const MOD = 'google-chat/auth'

// Unlike Slack/Discord (a bot token per connected org/guild), Google Chat's
// unlisted-app model has exactly one app identity for every org — the Chat
// app itself, owned by answerLoops' own Google Cloud project. Sending a
// message therefore authenticates as that single service account, scoped to
// the chat.bot scope, not as a per-org credential. Per-org routing happens
// separately, by mapping the incoming event's space id to an `integrations`
// row (see lib/db/queries/integrations.ts).
const CHAT_BOT_SCOPE = 'https://www.googleapis.com/auth/chat.bot'

let auth: GoogleAuth | null = null

function getAuth(): GoogleAuth {
  if (auth) return auth
  const credentialsJson = process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON
  if (!credentialsJson) {
    throw new Error('GOOGLE_CHAT_SERVICE_ACCOUNT_JSON is not configured')
  }
  auth = new GoogleAuth({
    credentials: JSON.parse(credentialsJson) as Record<string, string>,
    scopes: [CHAT_BOT_SCOPE],
  })
  return auth
}

/** Returns a bearer access token for calling the Google Chat REST API as the app. */
export async function getGoogleChatAccessToken(): Promise<string | null> {
  try {
    const client = await getAuth().getClient()
    const { token } = await client.getAccessToken()
    return token ?? null
  } catch (err) {
    logger.error('failed to obtain Google Chat access token', { module: MOD, error: err })
    return null
  }
}
