import { GoogleGenerativeAI } from '@google/generative-ai'
import logger from '../utils/logger'

// Gemini 2.0 Flash — free tier, 1M token context, fast
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
const flash = () => genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

export type EmailComplexity = 'spam' | 'simple' | 'complex'

/**
 * Classify email as spam/simple/complex.
 * Spam → skip AI entirely. Simple → Claude Haiku direct. Complex → summarize first.
 * Returns 'simple' on any error so the pipeline always continues.
 */
export async function classifyEmail(
	subject: string,
	body: string,
): Promise<EmailComplexity> {
	console.log('this is me classification geminiservice')

	if (!process.env.GEMINI_API_KEY) return 'simple'

	try {
		const prompt = `Classify this email in one word: "spam", "simple", or "complex".
- spam: marketing newsletters, promotional campaigns, discount offers, bulk marketing with unsubscribe links — NO real customer data
- simple: short direct customer enquiry, single clear request, under ~200 words
- complex: lead notification from a comparison/aggregator site (comparemymove, gocompare, moneysupermarket, bark.com, checkatrade, etc.), long thread, multiple data fields to extract, structured form-style data

IMPORTANT: Lead notification emails from comparison or aggregator platforms are NEVER spam — classify them as "complex" even though they are automated, because they contain real customer contact details and service requirements that must be extracted.

Subject: ${subject}
Body (first 600 chars): ${body.slice(0, 600)}

Reply with exactly one word: spam, simple, or complex`

		const result = await flash().generateContent(prompt)
		const text = result.response.text().trim().toLowerCase()

		if (text.includes('spam')) return 'spam'
		if (text.includes('complex')) return 'complex'
		return 'simple'
	} catch (err) {
		logger.warn(
			`Gemini classify failed, defaulting to simple: ${(err as Error).message}`,
		)
		return 'simple'
	}
}

/**
 * Summarize a long email thread to ~200 words so Claude gets less tokens.
 * Falls back to truncation if Gemini is unavailable.
 */
export async function summarizeEmailThread(thread: string): Promise<string> {
	console.log('this is me geminiservice')

	if (!process.env.GEMINI_API_KEY || thread.length < 800) {
		return thread.slice(0, 1200)
	}

	try {
		const prompt = `Summarize this email thread in under 200 words. Keep: sender intent, key details (dates, addresses, requirements), tone, and any urgency signals. Remove: signatures, disclaimers, quoted footers.

Email thread:
${thread.slice(0, 8000)}

Write the summary now:`

		const result = await flash().generateContent(prompt)
		return result.response.text().trim()
	} catch (err) {
		logger.warn(
			`Gemini summarize failed, using truncation: ${(err as Error).message}`,
		)
		return thread.slice(0, 1200)
	}
}

/**
 * Generate a reply draft for a given email using Gemini Flash (free).
 * For higher quality replies, use generateReplyDraftWithClaude in aiService instead.
 */
export async function draftReplyWithGemini(
	emailBody: string,
	companyName: string,
	businessType: string,
	tone: 'professional' | 'friendly' | 'formal' = 'professional',
): Promise<string | null> {
	console.log('email gemini called there geminiservice')

	if (!process.env.GEMINI_API_KEY) return null

	try {
		const prompt = `You are a ${tone} email assistant for ${companyName}, a ${businessType} business.
Write a concise reply to the email below. 3-5 sentences max. No subject line. No placeholders like [Name].
Sign off as "The ${companyName} Team".

Customer email:
${emailBody.slice(0, 1000)}

Write the reply:`

		const result = await flash().generateContent(prompt)
		return result.response.text().trim()
	} catch (err) {
		logger.warn(`Gemini draft failed: ${(err as Error).message}`)
		return null
	}
}
