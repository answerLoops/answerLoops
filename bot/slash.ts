import {
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
  Collection,
  Message,
} from 'discord.js'
import { logger } from '../lib/logger'

const MOD = 'bot/slash'

const SLASH_COMMANDS = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the AI a question — answered instantly from the knowledge base')
    .addStringOption((opt) =>
      opt.setName('question').setDescription('Your question').setRequired(true).setMinLength(5).setMaxLength(1000)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('summarize')
    .setDescription('Summarize the last 20 messages in this channel into bullet points')
    .addIntegerOption((opt) =>
      opt.setName('count').setDescription('Number of messages to summarize (default 20, max 50)').setRequired(false).setMinValue(5).setMaxValue(50)
    )
    .toJSON(),
]

export async function registerSlashCommands(token: string, applicationId: string, guildId?: string): Promise<void> {
  const rest = new REST().setToken(token)
  try {
    const route = guildId
      ? Routes.applicationGuildCommands(applicationId, guildId)
      : Routes.applicationCommands(applicationId)
    await rest.put(route, { body: SLASH_COMMANDS })
    logger.info('slash commands registered', { module: MOD, guildId: guildId ?? 'global', count: SLASH_COMMANDS.length })
  } catch (err) {
    logger.error('failed to register slash commands', { module: MOD, error: err })
  }
}

export interface SlashConfig {
  targetUrl: string
  botSecret: string
}

export async function handleAsk(interaction: ChatInputCommandInteraction, cfg: SlashConfig): Promise<void> {
  const question = interaction.options.getString('question', true)
  await interaction.deferReply()

  try {
    const res = await fetch(`${cfg.targetUrl}/api/slash/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.botSecret}` },
      body: JSON.stringify({ question, channel_id: interaction.channelId }),
    })

    if (!res.ok) {
      const body = await res.text()
      logger.error('/api/slash/ask failed', { module: MOD, status: res.status, body })
      await interaction.editReply('Sorry, the AI failed to answer. Please try again.')
      return
    }

    const { answer } = (await res.json()) as { answer: string }
    await interaction.editReply(answer.slice(0, 2000))
  } catch (err) {
    logger.error('handleAsk error', { module: MOD, error: err })
    await interaction.editReply('Something went wrong. Please try again.').catch(() => null)
  }
}

export async function handleSummarize(interaction: ChatInputCommandInteraction, cfg: SlashConfig): Promise<void> {
  const count = interaction.options.getInteger('count') ?? 20
  await interaction.deferReply()

  try {
    const channel = interaction.channel as TextChannel
    const fetched: Collection<string, Message> = await channel.messages.fetch({ limit: count })
    const messages = fetched
      .filter((m) => !m.author.bot || m.content.length > 0)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((m) => `${m.author.username}: ${m.content}`)

    if (messages.length === 0) {
      await interaction.editReply('No messages to summarize.')
      return
    }

    const res = await fetch(`${cfg.targetUrl}/api/slash/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.botSecret}` },
      body: JSON.stringify({ messages, channel_id: interaction.channelId }),
    })

    if (!res.ok) {
      logger.error('/api/slash/summarize failed', { module: MOD, status: res.status })
      await interaction.editReply('Failed to summarize. Please try again.')
      return
    }

    const { summary } = (await res.json()) as { summary: string }
    await interaction.editReply(`**Thread summary (last ${messages.length} messages):**\n\n${summary}`.slice(0, 2000))
  } catch (err) {
    logger.error('handleSummarize error', { module: MOD, error: err })
    await interaction.editReply('Something went wrong. Please try again.').catch(() => null)
  }
}
