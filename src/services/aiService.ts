import Anthropic from '@anthropic-ai/sdk'
import { BusinessType, LEAD_PROFILES } from '../config/leadProfiles'
import { UsageLog } from '../models/UsageLog'
import logger from '../utils/logger'
import { classifyEmail, summarizeEmailThread } from './geminiService'

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
	emailSubject = '',
): Promise<AiLeadResult | null> {
	console.log('inside the ai module of extract lead')

	// Step 1: Gemini classifies spam for free — skip Claude entirely if spam
	// Known lead aggregator domains always contain real customer data — never spam
	const LEAD_AGGREGATOR_DOMAINS = [
		'comparemymove.com', 'anyvan.com', 'reallymoving.com', 'movingiq.co.uk',
		'shiply.com', 'bark.com', 'gocompare.com', 'comparethemarket.com',
		'moneysupermarket.com', 'confused.com', 'checkatrade.com',
		'ratedpeople.com', 'trustatrader.com', 'mybuilder.com',
		'zoopla.co.uk', 'rightmove.co.uk', 'onthemarket.com',
	]
	const fromDomain = emailFrom.split('@')[1]?.toLowerCase() ?? ''
	const isKnownAggregator = LEAD_AGGREGATOR_DOMAINS.some(
		(d) => fromDomain === d || fromDomain.endsWith('.' + d),
	)

	let complexity = isKnownAggregator
		? ('complex' as const)
		: await classifyEmail(emailSubject, emailBody)

	if (complexity === 'spam') {
		logger.debug(
			`Gemini classified email from ${emailFrom} as spam — skipped Claude`,
		)
		return null
	}

	const profile = LEAD_PROFILES[businessType]

	// Step 2: Long/complex emails → Gemini summarizes to ~200 words before Claude sees them
	const processedBody =
		complexity === 'complex' || emailBody.length > 800
			? await summarizeEmailThread(emailBody)
			: emailBody.slice(0, 1200)
	logger.debug(
		`Email from ${emailFrom} classified as ${complexity}, ${emailBody.length} chars original, ${processedBody.length} chars sent to Claude`,
	)
	// Truncate to save tokens — 1200 chars covers most emails including bottom signatures
	const truncatedBody = processedBody.slice(0, 1200)
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
		logUsage(
			userId,
			response.usage as Anthropic.Usage & {
				cache_read_input_tokens?: number | null
			},
		).catch(() => {})
	}

	const raw = (
		response.content[0] as { type: string; text: string }
	).text.trim()
	const jsonStr = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '')
	return JSON.parse(jsonStr) as AiLeadResult
}

async function logUsage(
	userId: string,
	usage: Anthropic.Usage & { cache_read_input_tokens?: number | null },
): Promise<void> {
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

	logger.debug(
		`AI call: ${inputTokens}in/${outputTokens}out tokens, $${costUsd.toFixed(6)}`,
	)
}

// ─── Reply Drafting ───────────────────────────────────────────────────────────

const REPLY_SYSTEM = `You are a professional email assistant. Write concise, warm reply drafts for business owners.
3-5 sentences max. Plain text only. No subject line. No placeholder brackets like [Name] — use the real name if known.
Match the customer's tone: urgent emails get prompt/direct replies, friendly emails get warm replies.`

export interface ReplyDraftResult {
	draft: string
	model: 'claude-haiku' | 'skipped'
	costUsd: number
}

/**
 * Generate a professional reply draft using Claude Haiku.
 * The Gemini-summarized body is passed in so Claude sees fewer tokens.
 * Returns null if email was pre-classified as spam.
 */
export async function generateReplyDraft(
	emailBody: string,
	emailSubject: string,
	customerName: string | null,
	companyName: string,
	businessType: string,
	tone: 'professional' | 'friendly' | 'formal' = 'professional',
	userId?: string,
): Promise<ReplyDraftResult> {
	const greeting = customerName ? `Hi ${customerName}` : 'Hello'
	console.log('inside the ai module')

	const userPrompt = `${companyName} is a ${businessType} business. Tone: ${tone}.
Customer name: ${customerName || 'unknown'}
Email subject: ${emailSubject}
Customer message:
${emailBody.slice(0, 800)}

Write a ${tone} reply starting with "${greeting},":`

	const response = await client.messages.create({
		model: 'claude-haiku-4-5-20251001',
		max_tokens: 250,
		system: [
			{
				type: 'text',
				text: REPLY_SYSTEM,
				cache_control: { type: 'ephemeral' },
			} as Anthropic.TextBlockParam & { cache_control: { type: string } },
		],
		messages: [{ role: 'user', content: userPrompt }],
	})

	const usage = response.usage as Anthropic.Usage & {
		cache_read_input_tokens?: number | null
	}
	const cachedTokens = usage.cache_read_input_tokens ?? 0
	const costUsd =
		(usage.input_tokens - cachedTokens) * 0.0000008 +
		cachedTokens * 0.00000008 +
		usage.output_tokens * 0.000004

	if (userId) {
		UsageLog.create({
			userId,
			aiModel: 'claude-haiku-4-5-20251001',
			inputTokens: usage.input_tokens,
			outputTokens: usage.output_tokens,
			cachedTokens,
			costUsd,
		}).catch(() => {})
	}

	logger.debug(
		`Reply draft: ${usage.input_tokens}in/${usage.output_tokens}out tokens, $${costUsd.toFixed(6)}`,
	)

	return {
		draft: (response.content[0] as { text: string }).text.trim(),
		model: 'claude-haiku',
		costUsd,
	}
}

const DIGEST_SYSTEM =
	'You write concise, professional morning email digests for business owners. 2 sentences max. Plain text only, no emojis. Tone: professional and motivating.'

export async function generateDigestSummary(
	total: number,
	hot: number,
	cold: number,
	businessType: string,
): Promise<string> {
	const res = await client.messages.create({
		model: 'claude-haiku-4-5-20251001',
		max_tokens: 120,
		system: [
			{
				type: 'text',
				text: DIGEST_SYSTEM,
				cache_control: { type: 'ephemeral' },
			} as Anthropic.TextBlockParam & { cache_control: { type: string } },
		],
		messages: [
			{
				role: 'user',
				content: `${businessType} business digest. ${total} new leads today — ${hot} hot (score 7+), ${cold} cold (score <4). Write the 2-sentence summary.`,
			},
		],
	})
	return (res.content[0] as { text: string }).text
}
