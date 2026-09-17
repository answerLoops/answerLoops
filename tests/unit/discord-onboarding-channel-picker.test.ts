import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// The 1-click Discord OAuth onboarding path previously skipped channel
// selection entirely: the bot joined the server, but bot/handlers.ts only
// forwards messages whose channel is in the integration's channel_ids list
// (see isMonitored/shouldForward), and the OAuth callback never set that
// list. The onboarding wizard's discord_connected=1 handler then jumped
// straight past the Connect step to Seed KB, so a new user finished
// onboarding believing Discord was live while every message the bot saw was
// silently dropped — the only signal was a server-side log line
// ("No channel IDs configured") nobody sees.
//
// Fix: the callback now passes guild_id back to the onboarding redirect, and
// the wizard renders the same channel picker Settings already uses (fetching
// channels for that guild via GET /api/discord/guilds?guild_id=, which uses
// the platform bot token — no per-org token needed) before letting the user
// continue.
//
// Source-file structural assertions — same convention as
// infra-discord-oauth.test.ts (Next.js route modules can't be imported here).

const ROOT = process.cwd()

function read(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('Discord OAuth callback passes guild_id back to onboarding', () => {
  it('the onboarding redirect includes guild_id, not just discord_connected', () => {
    const src = read('app/api/discord/callback/route.ts')
    const onboardingBlock = src.slice(src.indexOf("if (from === 'onboarding') {"))
    expect(onboardingBlock).toContain("next.searchParams.set('discord_connected', '1')")
    expect(onboardingBlock.slice(0, 200)).toContain("next.searchParams.set('guild_id', guildId)")
  })
})

describe('onboarding wizard routes 1-click Discord connects to the channel picker', () => {
  it('no longer marks connect done and jumps straight to seed on discord_connected=1', () => {
    const src = read('app/onboarding/wizard.tsx')
    // The old bug: 'connect' was added to completed and step jumped to 'seed'
    // in the same effect that reads discord_connected, with no channel step.
    const effectBody = src.slice(
      src.indexOf("discord_connected") ,
      src.indexOf('}, [searchParams])')
    )
    expect(effectBody).not.toMatch(/new Set\(\[\.\.\.prev, 'name', 'connect'\]\)/)
    expect(effectBody).not.toContain("setStep('seed')")
    expect(effectBody).toContain("setStep('connect')")
  })

  it('captures guild_id from the callback redirect into state', () => {
    const src = read('app/onboarding/wizard.tsx')
    expect(src).toContain('discordOAuthGuildId')
    expect(src).toContain("searchParams.get('guild_id')")
  })

  it('DiscordFlow fetches channels for the OAuth guild via the platform-bot-token endpoint', () => {
    const src = read('app/onboarding/wizard.tsx')
    expect(src).toContain('oauthGuildId')
    expect(src).toContain('/api/discord/guilds?guild_id=${oauthGuildId}')
  })

  it('lands directly on the channels sub-step when returning from OAuth, skipping choose/invite', () => {
    const src = read('app/onboarding/wizard.tsx')
    expect(src).toContain("useState<DiscordSubStep>(oauthGuildId ? 'channels' : 'choose')")
  })

  it('tells the user explicitly that nothing is monitored until they pick a channel', () => {
    const src = read('app/onboarding/wizard.tsx')
    expect(src).toMatch(/won.t send any messages here until you select at least one channel/)
  })

  it('saves OAuth channel selections through the guild-specific action without requiring a token', () => {
    const src = read('app/onboarding/wizard.tsx')
    const saveBlock = src.slice(src.indexOf('async function save()'), src.indexOf('function toggleChannel'))
    expect(saveBlock).toContain('saveDiscordGuildChannelsAction')
    expect(saveBlock).toContain("fd.set('guildId', oauthGuildId)")
    expect(saveBlock).toContain('saveDiscordIntegrationAction')
  })

  it('ConnectStep defaults straight into the Discord flow when oauthGuildId is present, skipping the platform picker', () => {
    const src = read('app/onboarding/wizard.tsx')
    expect(src).toContain("oauthGuildId ? 'discord' : slackConnected ? 'slack' : githubConnected ? 'github' : null")
  })
})

// Same bug class as Discord above, for Slack: the callback used to hardcode
// a redirect to /settings regardless of where the OAuth flow started,
// bouncing a mid-onboarding user out of the wizard onto a page they never
// asked for. Worse, even a settings-invoked connect left channel selection
// to a separate manual step in Settings — a customer could authorize their
// workspace and believe Slack was live while zero channels were monitored,
// since bot/handlers.ts only forwards messages whose channel is in the
// integration's channel_ids list.
//
// Fix: the OAuth state now carries a `from` flag (same mechanism Discord
// already used) so the callback can return to /onboarding, and the wizard
// renders a channel picker (fetching via GET /api/slack/channels, which uses
// the org's own bot token) immediately after the workspace is authorized,
// before letting the user continue.

describe('Slack OAuth callback returns to onboarding when the flow started there', () => {
  it('redirects to /onboarding, not /settings, when state carries from=onboarding', () => {
    const src = read('app/api/slack/callback/route.ts')
    expect(src).toContain("new URL(from === 'onboarding' ? '/onboarding' : '/settings', baseUrl)")
  })

  it('install route encodes the from flag into the OAuth state', () => {
    const src = read('app/api/slack/install/route.ts')
    expect(src).toContain("req.nextUrl.searchParams.get('from')")
    expect(src).toContain('from }')
  })

  it('still sets slack_connected on the redirect regardless of origin', () => {
    const src = read('app/api/slack/callback/route.ts')
    expect(src).toContain("settingsUrl.searchParams.set('slack_connected', '1')")
  })
})

describe('onboarding wizard routes 1-click Slack connects to the channel picker', () => {
  it('does not skip past the Connect step to seed on slack_connected=1', () => {
    const src = read('app/onboarding/wizard.tsx')
    const effectBody = src.slice(
      src.indexOf("searchParams.get('slack_connected')"),
      src.indexOf('}, [searchParams])', src.indexOf("searchParams.get('slack_connected')"))
    )
    expect(effectBody).not.toContain("setStep('seed')")
    expect(effectBody).toContain("setStep('connect')")
    expect(effectBody).toContain('setSlackConnected(true)')
  })

  it('SlackFlow fetches channels via the org-scoped endpoint once connected', () => {
    const src = read('app/onboarding/wizard.tsx')
    expect(src).toContain("fetch('/api/slack/channels')")
  })

  it('tells the user explicitly that nothing is monitored until they pick a channel', () => {
    const src = read('app/onboarding/wizard.tsx')
    expect(src).toMatch(/Slack won.{0,8}t send any messages here until you select at least one channel/)
  })

  it('saves selected channels through the same server action Settings uses', () => {
    const src = read('app/onboarding/wizard.tsx')
    expect(src).toContain('saveSlackChannelsAction')
  })
})
