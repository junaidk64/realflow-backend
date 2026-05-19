import { OAuth2Client } from 'google-auth-library'
import { google } from 'googleapis'

import { config } from '../config'
import { GmailConnection, IGmailConnection } from '../models/GmailConnection'
import { decrypt, encrypt } from '../utils/encryption'
import logger from '../utils/logger'

export interface GmailMessage {
	id: string
	threadId: string
	snippet: string
	subject: string
	from: string
	fromEmail: string
	to: string
	date: Date
	textBody: string
	htmlBody: string
	labelIds: string[]
}

const createOAuth2Client = (
	accessToken: string,
	refreshToken: string,
): OAuth2Client => {
	const auth = new OAuth2Client(
		config.google.clientId,
		config.google.clientSecret,
		config.google.redirectUri,
	)
	auth.setCredentials({
		access_token: accessToken,
		refresh_token: refreshToken,
	})
	return auth
}

export const getAuthenticatedClient = async (
	gmailConnection: IGmailConnection,
): Promise<OAuth2Client> => {
	const accessToken = decrypt(gmailConnection.accessToken)
	const refreshToken = decrypt(gmailConnection.refreshToken)

	const auth = createOAuth2Client(accessToken, refreshToken)

	// Check if token is expired and refresh if needed
	const now = new Date()
	if (gmailConnection.tokenExpiry < now) {
		logger.info(`Refreshing token for ${gmailConnection.email}`)
		const { credentials } = await auth.refreshAccessToken()

		await GmailConnection.findByIdAndUpdate(gmailConnection._id, {
			accessToken: encrypt(credentials.access_token!),
			tokenExpiry: new Date(credentials.expiry_date!),
		})

		auth.setCredentials(credentials)
	}

	return auth
}

export const saveGmailConnection = async (
	userId: string,
	email: string,
	accessToken: string,
	refreshToken: string,
	tokenExpiry: Date,
): Promise<IGmailConnection> => {
	const connection = await GmailConnection.findOneAndUpdate(
		{ userId },
		{
			userId,
			email,
			accessToken: encrypt(accessToken),
			refreshToken: encrypt(refreshToken),
			tokenExpiry,
			isActive: true,
		},
		{ upsert: true, new: true, setDefaultsOnInsert: true },
	)
	return connection
}

export const setupGmailWatch = async (
	gmailConnection: IGmailConnection,
): Promise<void> => {
	try {
		const auth = await getAuthenticatedClient(gmailConnection)
		const gmail = google.gmail({ version: 'v1', auth })

		if (!config.google.pubsubTopic) {
			logger.warn(
				'GOOGLE_PUBSUB_TOPIC not configured, skipping Gmail watch setup',
			)
			return
		}

		const response = await gmail.users.watch({
			userId: 'me',
			requestBody: {
				topicName: config.google.pubsubTopic,
				labelIds: ['INBOX'],
				labelFilterAction: 'include',
			},
		})

		const expiry = new Date(parseInt(response.data.expiration!, 10))
		await GmailConnection.findByIdAndUpdate(gmailConnection._id, {
			historyId: response.data.historyId || '',
			watchExpiry: expiry,
		})

		logger.info(
			`Gmail watch setup for ${gmailConnection.email}, expires: ${expiry}`,
		)
	} catch (error) {
		logger.error(
			`Failed to setup Gmail watch for ${gmailConnection.email}:`,
			error,
		)
		throw error
	}
}

export const listMessages = async (
	gmailConnection: IGmailConnection,
	maxResults: number = 20,
	query: string = 'in:inbox is:unread',
): Promise<string[]> => {
	const auth = await getAuthenticatedClient(gmailConnection)
	const gmail = google.gmail({ version: 'v1', auth })

	const response = await gmail.users.messages.list({
		userId: 'me',
		maxResults,
		q: query,
	})

	return (response.data.messages || []).map((m) => m.id!)
}

export const getMessage = async (
	gmailConnection: IGmailConnection,
	messageId: string,
): Promise<GmailMessage | null> => {
	try {
		const auth = await getAuthenticatedClient(gmailConnection)
		const gmail = google.gmail({ version: 'v1', auth })

		const response = await gmail.users.messages.get({
			userId: 'me',
			id: messageId,
			format: 'full',
		})

		return parseGmailMessage(response.data)
	} catch (error) {
		logger.error(`Failed to get Gmail message ${messageId}:`, error)
		return null
	}
}

export const parseGmailMessage = (message: {
	id?: string | null
	threadId?: string | null
	snippet?: string | null
	labelIds?: string[] | null
	payload?: {
		headers?: Array<{ name?: string | null; value?: string | null }> | null
		body?: { data?: string | null } | null
		parts?: Array<{
			mimeType?: string | null
			body?: { data?: string | null } | null
			parts?: Array<{
				mimeType?: string | null
				body?: { data?: string | null } | null
			}> | null
		}> | null
	} | null
}): GmailMessage => {
	const headers = message.payload?.headers || []
	const getHeader = (name: string): string => {
		const header = headers.find(
			(h) => h.name?.toLowerCase() === name.toLowerCase(),
		)
		return header?.value || ''
	}

	const subject = getHeader('Subject')
	const fromHeader = getHeader('From')
	const to = getHeader('To')
	const dateStr = getHeader('Date')

	// Parse from header: "Name <email>" or just "email"
	const emailMatch = fromHeader.match(/<([^>]+)>/)
	const fromEmail = emailMatch ? emailMatch[1] : fromHeader
	const nameMatch = fromHeader.match(/^"?([^"<]+)"?\s*</)
	const fromName = nameMatch ? nameMatch[1].trim() : fromEmail

	let textBody = ''
	let htmlBody = ''

	const extractBody = (payload: typeof message.payload): void => {
		if (!payload) return

		if (payload.body?.data) {
			const decoded = Buffer.from(payload.body.data, 'base64').toString('utf-8')
			textBody = decoded
			return
		}

		for (const part of payload.parts || []) {
			if (part.mimeType === 'text/plain' && part.body?.data) {
				textBody = Buffer.from(part.body.data, 'base64').toString('utf-8')
			} else if (part.mimeType === 'text/html' && part.body?.data) {
				htmlBody = Buffer.from(part.body.data, 'base64').toString('utf-8')
			} else if (part.mimeType?.startsWith('multipart/')) {
				for (const subPart of part.parts || []) {
					if (subPart.mimeType === 'text/plain' && subPart.body?.data) {
						textBody = Buffer.from(subPart.body.data, 'base64').toString(
							'utf-8',
						)
					} else if (subPart.mimeType === 'text/html' && subPart.body?.data) {
						htmlBody = Buffer.from(subPart.body.data, 'base64').toString(
							'utf-8',
						)
					}
				}
			}
		}
	}

	extractBody(message.payload)

	return {
		id: message.id || '',
		threadId: message.threadId || '',
		snippet: message.snippet || '',
		subject,
		from: fromName,
		fromEmail,
		to,
		date: dateStr ? new Date(dateStr) : new Date(),
		textBody,
		htmlBody,
		labelIds: message.labelIds || [],
	}
}

export const processNewEmails = async (
	gmailConnection: IGmailConnection,
): Promise<GmailMessage[]> => {
	try {
		const auth = await getAuthenticatedClient(gmailConnection)
		const gmail = google.gmail({ version: 'v1', auth })

		let messageIds: string[] = []

		if (gmailConnection.historyId) {
			try {
				const historyResponse = await gmail.users.history.list({
					userId: 'me',
					startHistoryId: gmailConnection.historyId,
					historyTypes: ['messageAdded'],
					labelId: 'INBOX',
				})

				const history = historyResponse.data.history || []
				for (const record of history) {
					for (const msg of record.messagesAdded || []) {
						if (msg.message?.id) {
							messageIds.push(msg.message.id)
						}
					}
				}

				if (historyResponse.data.historyId) {
					await GmailConnection.findByIdAndUpdate(gmailConnection._id, {
						historyId: historyResponse.data.historyId,
						lastSyncAt: new Date(),
						syncError: null,
					})
				}
			} catch (historyError: unknown) {
				if ((historyError as { code?: number }).code === 404) {
					// History not found, fall back to listing unread
					logger.warn(
						`History not found for ${gmailConnection.email}, falling back to list`,
					)
					messageIds = await listMessages(
						gmailConnection,
						10,
						'in:inbox is:unread newer_than:1d',
					)
				} else {
					throw historyError
				}
			}
		} else {
			// First sync: get recent unread
			messageIds = await listMessages(
				gmailConnection,
				10,
				'in:inbox is:unread newer_than:1d',
			)

			// Set initial historyId
			const profile = await gmail.users.getProfile({ userId: 'me' })
			await GmailConnection.findByIdAndUpdate(gmailConnection._id, {
				historyId: profile.data.historyId || '',
				lastSyncAt: new Date(),
			})
		}

		const messages: GmailMessage[] = []
		for (const id of messageIds) {
			const msg = await getMessage(gmailConnection, id)
			if (msg) messages.push(msg)
		}

		return messages
	} catch (error) {
		logger.error(
			`Failed to process emails for ${gmailConnection.email}:`,
			error,
		)
		await GmailConnection.findByIdAndUpdate(gmailConnection._id, {
			syncError: (error as Error).message,
		})
		throw error
	}
}

export const markAsRead = async (
	gmailConnection: IGmailConnection,
	messageId: string,
): Promise<void> => {
	const auth = await getAuthenticatedClient(gmailConnection)
	const gmail = google.gmail({ version: 'v1', auth })

	await gmail.users.messages.modify({
		userId: 'me',
		id: messageId,
		requestBody: {
			removeLabelIds: ['UNREAD'],
		},
	})
}

export const getEmailStats = async (
	gmailConnection: IGmailConnection,
): Promise<{ unread: number; total: number }> => {
	const auth = await getAuthenticatedClient(gmailConnection)
	const gmail = google.gmail({ version: 'v1', auth })

	const [unreadRes, totalRes] = await Promise.all([
		gmail.users.messages.list({
			userId: 'me',
			q: 'in:inbox is:unread',
			maxResults: 1,
		}),
		gmail.users.messages.list({ userId: 'me', q: 'in:inbox', maxResults: 1 }),
	])

	return {
		unread: unreadRes.data.resultSizeEstimate || 0,
		total: totalRes.data.resultSizeEstimate || 0,
	}
}

export default {
	getAuthenticatedClient,
	saveGmailConnection,
	setupGmailWatch,
	listMessages,
	getMessage,
	parseGmailMessage,
	processNewEmails,
	markAsRead,
	getEmailStats,
}
