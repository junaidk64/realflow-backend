import crypto from 'crypto'
import logger from '../utils/logger'

const WA_API_BASE = 'https://graph.facebook.com/v21.0'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WASendResult {
	success: boolean
	messageId?: string
	error?: string
}

export interface WAIncomingMessage {
	from: string          // sender phone number (E.164, no +)
	messageId: string     // wamid.xxx
	timestamp: string
	type: string          // text | image | video | audio | document | etc.
	text?: string
	mediaId?: string
	mediaCaption?: string
	mimeType?: string
	senderName?: string
}

export interface WAStatusUpdate {
	messageId: string
	recipientPhone: string
	status: 'sent' | 'delivered' | 'read' | 'failed'
	timestamp: string
	errorCode?: number
	errorMessage?: string
}

export interface WAWebhookPayload {
	phoneNumberId: string
	wabaId: string
	messages: WAIncomingMessage[]
	statuses: WAStatusUpdate[]
}

// ─── Signature Verification ───────────────────────────────────────────────────

/**
 * Validates X-Hub-Signature-256 from Meta.
 * rawBody must be the raw Buffer (before JSON.parse).
 */
export const verifyWebhookSignature = (
	rawBody: Buffer,
	signature: string,
	appSecret: string,
): boolean => {
	try {
		const expected = `sha256=${crypto
			.createHmac('sha256', appSecret)
			.update(rawBody)
			.digest('hex')}`
		return crypto.timingSafeEqual(
			Buffer.from(expected, 'utf8'),
			Buffer.from(signature, 'utf8'),
		)
	} catch {
		return false
	}
}

// ─── Webhook Parser ───────────────────────────────────────────────────────────

/**
 * Flattens the nested Meta webhook payload into our internal format.
 * Handles both incoming messages and delivery status changes.
 */
export const parseWebhookPayload = (body: Record<string, unknown>): WAWebhookPayload[] => {
	const results: WAWebhookPayload[] = []

	const entries = (body.entry as unknown[]) ?? []
	for (const entry of entries) {
		const e = entry as Record<string, unknown>
		const wabaId = String(e.id ?? '')
		const changes = (e.changes as unknown[]) ?? []

		for (const change of changes) {
			const c = change as Record<string, unknown>
			if ((c.field as string) !== 'messages') continue

			const value = c.value as Record<string, unknown>
			const metadata = value.metadata as Record<string, unknown>
			const phoneNumberId = String(metadata?.phone_number_id ?? '')

			const contacts = (value.contacts as Record<string, unknown>[]) ?? []
			const nameMap: Record<string, string> = {}
			for (const contact of contacts) {
				const waId = String(contact.wa_id ?? '')
				const profile = contact.profile as Record<string, unknown>
				nameMap[waId] = String(profile?.name ?? '')
			}

			const messages: WAIncomingMessage[] = []
			for (const raw of (value.messages as Record<string, unknown>[]) ?? []) {
				const msg: WAIncomingMessage = {
					from: String(raw.from ?? ''),
					messageId: String(raw.id ?? ''),
					timestamp: String(raw.timestamp ?? ''),
					type: String(raw.type ?? 'text'),
					senderName: nameMap[String(raw.from ?? '')] ?? '',
				}

				switch (msg.type) {
					case 'text':
						msg.text = String((raw.text as Record<string, unknown>)?.body ?? '')
						break
					case 'image':
					case 'video':
					case 'audio':
					case 'document':
					case 'sticker': {
						const media = raw[msg.type] as Record<string, unknown>
						msg.mediaId = String(media?.id ?? '')
						msg.mediaCaption = String(media?.caption ?? '')
						msg.mimeType = String(media?.mime_type ?? '')
						break
					}
					case 'location': {
						const loc = raw.location as Record<string, unknown>
						msg.text = `Location: ${loc?.name ?? ''} (${loc?.latitude}, ${loc?.longitude})`
						break
					}
					default:
						msg.text = `[${msg.type} message]`
				}

				messages.push(msg)
			}

			const statuses: WAStatusUpdate[] = []
			for (const raw of (value.statuses as Record<string, unknown>[]) ?? []) {
				const errors = (raw.errors as Record<string, unknown>[]) ?? []
				statuses.push({
					messageId: String(raw.id ?? ''),
					recipientPhone: String(raw.recipient_id ?? ''),
					status: raw.status as WAStatusUpdate['status'],
					timestamp: String(raw.timestamp ?? ''),
					errorCode: errors[0]?.code as number | undefined,
					errorMessage: errors[0]?.title as string | undefined,
				})
			}

			results.push({ phoneNumberId, wabaId, messages, statuses })
		}
	}

	return results
}

// ─── Send Messages ────────────────────────────────────────────────────────────

async function waPost(
	phoneNumberId: string,
	accessToken: string,
	body: Record<string, unknown>,
): Promise<WASendResult> {
	try {
		const res = await fetch(`${WA_API_BASE}/${phoneNumberId}/messages`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		})

		const data = (await res.json()) as Record<string, unknown>

		if (!res.ok) {
			const err = (data.error as Record<string, unknown>) ?? {}
			const msg = String(err.message ?? `HTTP ${res.status}`)
			logger.error('WhatsApp API error:', data)
			return { success: false, error: msg }
		}

		const messages = data.messages as Record<string, unknown>[]
		return { success: true, messageId: String(messages?.[0]?.id ?? '') }
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Unknown error'
		logger.error('WhatsApp send error:', err)
		return { success: false, error: msg }
	}
}

export const sendTextMessage = (
	phoneNumberId: string,
	accessToken: string,
	to: string,
	text: string,
): Promise<WASendResult> =>
	waPost(phoneNumberId, accessToken, {
		messaging_product: 'whatsapp',
		recipient_type: 'individual',
		to,
		type: 'text',
		text: { preview_url: false, body: text },
	})

export const sendTemplateMessage = (
	phoneNumberId: string,
	accessToken: string,
	to: string,
	templateName: string,
	languageCode = 'en_US',
	components: unknown[] = [],
): Promise<WASendResult> =>
	waPost(phoneNumberId, accessToken, {
		messaging_product: 'whatsapp',
		to,
		type: 'template',
		template: {
			name: templateName,
			language: { code: languageCode },
			components,
		},
	})

export const sendMediaMessage = (
	phoneNumberId: string,
	accessToken: string,
	to: string,
	mediaType: 'image' | 'video' | 'audio' | 'document',
	mediaId: string,
	caption?: string,
): Promise<WASendResult> =>
	waPost(phoneNumberId, accessToken, {
		messaging_product: 'whatsapp',
		to,
		type: mediaType,
		[mediaType]: { id: mediaId, ...(caption ? { caption } : {}) },
	})

export const markMessageRead = async (
	phoneNumberId: string,
	accessToken: string,
	messageId: string,
): Promise<void> => {
	try {
		await fetch(`${WA_API_BASE}/${phoneNumberId}/messages`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				messaging_product: 'whatsapp',
				status: 'read',
				message_id: messageId,
			}),
		})
	} catch (err) {
		logger.error('markMessageRead error:', err)
	}
}

export default {
	verifyWebhookSignature,
	parseWebhookPayload,
	sendTextMessage,
	sendTemplateMessage,
	sendMediaMessage,
	markMessageRead,
}
