import Anthropic from '@anthropic-ai/sdk'
import { BusinessType, LEAD_PROFILES } from '../config/leadProfiles'
import { UsageLog } from '../models/UsageLog'
import logger from '../utils/logger'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Stable system prompt — cached by Claude after first call (5-min TTL)
const SYSTEM_PROMPT = `You are a lead extraction AI for a CRM system.
Extract lead information from emails and score lead quality.
Always respond with valid JSON only. No explanation text outside the JSON.
If a field cannot be determined, use null.`

export interface AiLeadResult {
  isLead: boolean
  customerName: string | null
  customerEmail: string | null
  customerPhone: string | null
  extractedFields: Record<string, string | null>
  notes: string | null
  aiScore: number
  aiScoreReason: string
  sentiment: 'positive' | 'neutral' | 'negative' | 'urgent'
}

export async function extractLeadFromEmail(
  emailBody: string,
  emailFrom: string,
  businessType: BusinessType,
  userId?: string,
): Promise<AiLeadResult> {
  const profile = LEAD_PROFILES[businessType]

  // Truncate to save tokens — signal is in first 800 chars
  const truncatedBody = emailBody.slice(0, 800)
  const emptyFields = profile.fields.reduce<Record<string, null>>(
    (acc, f) => ({ ...acc, [f]: null }),
    {},
  )

  const userPrompt = `Business: ${profile.description}
From: ${emailFrom}
Email body:
${truncatedBody}

Extract and return JSON with this exact structure:
{
  "isLead": boolean,
  "customerName": string|null,
  "customerEmail": string|null,
  "customerPhone": string|null,
  "extractedFields": ${JSON.stringify(emptyFields)},
  "notes": string|null,
  "aiScore": number 1-10,
  "aiScoreReason": string max 100 chars,
  "sentiment": "positive"|"neutral"|"negative"|"urgent"
}`

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      } as Anthropic.TextBlockParam & { cache_control: { type: string } },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  })

  // Log token usage and cost
  if (userId) {
    logUsage(userId, response.usage as Anthropic.Usage & { cache_read_input_tokens?: number | null }).catch(() => {})
  }

  const raw = (response.content[0] as { type: string; text: string }).text.trim()
  const jsonStr = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '')
  return JSON.parse(jsonStr) as AiLeadResult
}

async function logUsage(userId: string, usage: Anthropic.Usage & { cache_read_input_tokens?: number | null }): Promise<void> {
  const inputTokens = usage.input_tokens
  const outputTokens = usage.output_tokens
  const cachedTokens = usage.cache_read_input_tokens ?? 0

  // Haiku pricing: $0.80/M input, $4.00/M output, $0.08/M cached
  const costUsd =
    (inputTokens - cachedTokens) * 0.0000008 +
    cachedTokens * 0.00000008 +
    outputTokens * 0.000004

  await UsageLog.create({
    userId,
    aiModel: 'claude-haiku-4-5-20251001',
    inputTokens,
    outputTokens,
    cachedTokens,
    costUsd,
  })

  logger.debug(`AI call: ${inputTokens}in/${outputTokens}out tokens, $${costUsd.toFixed(6)}`)
}

export async function generateDigestSummary(
  total: number,
  hot: number,
  cold: number,
  businessType: string,
): Promise<string> {
  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    messages: [
      {
        role: 'user',
        content: `Write a 2-sentence morning email digest for a ${businessType} business.
Stats: ${total} new leads, ${hot} hot (score 7+), ${cold} cold (score <4).
Tone: professional, motivating. No emojis. Plain text only.`,
      },
    ],
  })
  return (res.content[0] as { text: string }).text
}
