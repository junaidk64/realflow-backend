import { NextFunction, Request, Response } from 'express'
import mongoose from 'mongoose'
import config from '../config'
import { EmailLog } from '../models/EmailLog'
import { Lead } from '../models/Lead'
import { WhatsAppConnection } from '../models/WhatsAppConnection'
import { emitToOrg, emitToUser } from '../services/socketService'
import {
	exchangeCodeForToken,
	getLongLivedToken,
	getPhoneNumberDetails,
	sendMediaMessage,
	sendTemplateMessage,
	sendTextMessage,
	subscribeAppToWABA,
} from '../services/whatsappService'
import { decrypt, encrypt } from '../utils/encryption'
import logger from '../utils/logger'

// ─── Embedded Signup Config ───────────────────────────────────────────────────

/**
 * Returns the platform Meta App ID needed by the frontend to initialise the
 * Facebook JS SDK and launch the Embedded Signup dialog.
 */
export const getEmbeddedSignupConfig = (_req: Request, res: Response): void => {
	res.json({
		success: true,
		data: {
			appId: config.whatsapp.appId,
			configId: `whatsapp_${config.whatsapp.appId}`,
		},
	})
}

// ─── Complete Embedded Signup ─────────────────────────────────────────────────

/**
 * Called by the frontend after the user completes the Meta Embedded Signup
 * dialog. The frontend supplies the short-lived authorization code and the
 * phoneNumberId / wabaId reported by Meta's onMessage callback.
 *
 * Flow:
 *   1. Exchange code → short-lived user access token
 *   2. Upgrade to long-lived token (~60 days)
 *   3. Fetch phone number display details from Meta
 *   4. Subscribe our platform app to the WABA for webhook events
 *   5. Persist / update the WhatsAppConnection record
 */
export const completeEmbeddedSignup = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { code, phoneNumberId, wabaId } = req.body as {
			code: string
			phoneNumberId: string
			wabaId: string
		}

		if (!code || !phoneNumberId || !wabaId) {
			res.status(400).json({
				success: false,
				message: 'code, phoneNumberId, and wabaId are required',
			})
			return
		}

		// 1. Exchange authorization code for access token
		const tokenResult = await exchangeCodeForToken(code)
		if (!tokenResult.success || !tokenResult.accessToken) {
			res.status(502).json({
				success: false,
				message: tokenResult.error ?? 'Failed to exchange authorization code',
			})
			return
		}

		// 2. Upgrade to long-lived token; fall back to short-lived on failure
		const longLivedResult = await getLongLivedToken(tokenResult.accessToken)
		const finalToken =
			longLivedResult.success && longLivedResult.accessToken
				? longLivedResult.accessToken
				: tokenResult.accessToken

		const expiresIn = longLivedResult.success
			? longLivedResult.expiresIn
			: tokenResult.expiresIn
		const tokenExpiry = expiresIn
			? new Date(Date.now() + expiresIn * 1000)
			: null // null = treat as non-expiring

		// 3. Fetch phone number display details (best-effort)
		const phoneDetails = await getPhoneNumberDetails(phoneNumberId, finalToken)

		// 4. Subscribe our app to the WABA so webhooks are routed to us
		const subscribed = await subscribeAppToWABA(wabaId, finalToken)
		if (!subscribed) {
			logger.warn(
				`WABA subscription failed for wabaId=${wabaId} — webhooks may not arrive`,
			)
		}

		// 5. Persist connection (one active per org or per user)
		const userId = req.user!.userId
		const organizationId = req.user!.organizationId?.toString() ?? null

		const filter = organizationId ? { organizationId } : { userId }
		const encryptedToken = encrypt(finalToken)

		const connection = await WhatsAppConnection.findOneAndUpdate(
			filter,
			{
				userId,
				organizationId,
				phoneNumberId,
				wabaId,
				displayPhoneNumber: phoneDetails.displayPhoneNumber,
				verifiedName: phoneDetails.verifiedName,
				accessToken: encryptedToken,
				tokenExpiry,
				isActive: true,
				syncError: null,
			},
			{ upsert: true, new: true },
		)

		logger.info(
			`WhatsApp connected via Embedded Signup — user=${userId} phone=${phoneDetails.displayPhoneNumber}`,
		)

		res.json({
			success: true,
			data: {
				id: connection._id,
				phoneNumberId,
				wabaId,
				displayPhoneNumber: phoneDetails.displayPhoneNumber,
				verifiedName: phoneDetails.verifiedName,
				isActive: true,
				tokenExpiry,
			},
		})
	} catch (error) {
		next(error)
	}
}

// ─── Disconnect WhatsApp ──────────────────────────────────────────────────────

export const disconnectWhatsApp = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const userId = req.user!.userId
		const organizationId = req.user!.organizationId?.toString() ?? null

		const filter = organizationId ? { organizationId } : { userId }
		await WhatsAppConnection.findOneAndUpdate(filter, { isActive: false })

		res.json({ success: true, message: 'WhatsApp disconnected' })
	} catch (error) {
		next(error)
	}
}

// ─── Get Status ───────────────────────────────────────────────────────────────

export const getWhatsAppStatus = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const userId = req.user!.userId
		const organizationId = req.user!.organizationId?.toString() ?? null

		const filter = organizationId ? { organizationId } : { userId }
		const connection = await WhatsAppConnection.findOne(filter)
			.select('-accessToken')
			.lean()

		res.json({
			success: true,
			data: {
				connected: !!connection?.isActive,
				connection: connection ?? null,
			},
		})
	} catch (error) {
		next(error)
	}
}

// ─── Send Message ─────────────────────────────────────────────────────────────

export const sendWhatsAppMessage = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const userId = req.user!.userId
		const organizationId = req.user!.organizationId?.toString() ?? null

		const {
			to,
			type = 'text',
			text,
			templateName,
			languageCode,
			components,
			mediaType,
			mediaId,
			caption,
			leadId,
		} = req.body as {
			to: string
			type?: 'text' | 'template' | 'media'
			text?: string
			templateName?: string
			languageCode?: string
			components?: unknown[]
			mediaType?: 'image' | 'video' | 'audio' | 'document'
			mediaId?: string
			caption?: string
			leadId?: string
		}

		if (!to) {
			res
				.status(400)
				.json({ success: false, message: 'Recipient phone number required' })
			return
		}

		const filter = organizationId
			? { organizationId, isActive: true }
			: { userId, isActive: true }
		const connection = await WhatsAppConnection.findOne(filter)
		if (!connection) {
			res
				.status(400)
				.json({ success: false, message: 'No active WhatsApp connection' })
			return
		}

		const accessToken = decrypt(connection.accessToken)

		let result
		let sentBody = ''

		if (type === 'text') {
			if (!text) {
				res.status(400).json({ success: false, message: 'text is required' })
				return
			}
			result = await sendTextMessage(
				connection.phoneNumberId,
				accessToken,
				to,
				text,
			)
			sentBody = text
		} else if (type === 'template') {
			if (!templateName) {
				res
					.status(400)
					.json({ success: false, message: 'templateName is required' })
				return
			}
			result = await sendTemplateMessage(
				connection.phoneNumberId,
				accessToken,
				to,
				templateName,
				languageCode,
				components,
			)
			sentBody = `[Template: ${templateName}]`
		} else if (type === 'media') {
			if (!mediaType || !mediaId) {
				res.status(400).json({
					success: false,
					message: 'mediaType and mediaId are required',
				})
				return
			}
			result = await sendMediaMessage(
				connection.phoneNumberId,
				accessToken,
				to,
				mediaType,
				mediaId,
				caption,
			)
			sentBody = caption ? `[${mediaType}: ${caption}]` : `[${mediaType}]`
		} else {
			res.status(400).json({ success: false, message: 'Invalid message type' })
			return
		}

		if (!result.success) {
			res.status(502).json({
				success: false,
				message: result.error ?? 'WhatsApp send failed',
			})
			return
		}

		// Persist outgoing message
		const resolvedLeadId = leadId
			? new mongoose.Types.ObjectId(leadId)
			: ((
					await Lead.findOne({
						userId,
						customerPhone: { $regex: to.replace(/\D/g, '') },
					})
				)?._id ?? null)

		const emailLog = await EmailLog.create({
			userId,
			leadId: resolvedLeadId,
			channel: 'whatsapp',
			type: 'outgoing',
			from: connection.displayPhoneNumber,
			to,
			subject: '',
			body: sentBody,
			htmlBody: '',
			whatsappMessageId: result.messageId ?? '',
			whatsappPhone: to,
			messageType:
				type === 'media'
					? (mediaType ?? 'image')
					: type === 'template'
						? 'template'
						: 'text',
			deliveryStatus: 'sent',
			status: 'sent',
			sentAt: new Date(),
		})

		// Real-time emit
		const msgPayload = {
			leadId: resolvedLeadId ? String(resolvedLeadId) : null,
			emailLogId: String(emailLog._id),
			channel: 'whatsapp',
			type: 'outgoing',
			from: connection.displayPhoneNumber,
			to,
			body: sentBody,
			messageType: emailLog.messageType,
			deliveryStatus: 'sent',
			timestamp: emailLog.sentAt,
		}
		if (organizationId)
			emitToOrg(organizationId, 'whatsapp:message:new', msgPayload)
		emitToUser(userId, 'whatsapp:message:new', msgPayload)

		res.json({
			success: true,
			data: { messageId: result.messageId, emailLogId: emailLog._id },
		})
	} catch (error) {
		next(error)
	}
}

// ─── Get Conversations (WhatsApp inbox list) ──────────────────────────────────

export const getWhatsAppConversations = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const userId = req.user!.userId
		const organizationId = req.user!.organizationId?.toString() ?? null
		const {
			page = '1',
			limit = '20',
			search = '',
		} = req.query as Record<string, string>

		const pageNum = Math.max(1, parseInt(page, 10))
		const limitNum = Math.min(50, parseInt(limit, 10))
		const skip = (pageNum - 1) * limitNum

		const leadFilter: Record<string, unknown> = organizationId
			? { organizationId }
			: { userId }

		if (search) {
			leadFilter.$or = [
				{ customerName: { $regex: search, $options: 'i' } },
				{ customerPhone: { $regex: search.replace(/\D/g, '') } },
			]
		}

		const leads = await Lead.find(leadFilter)
			.sort({ updatedAt: -1 })
			.skip(skip)
			.limit(limitNum)
			.lean()

		const leadIds = leads.map((l) => l._id)

		const lastMessages = await EmailLog.aggregate([
			{ $match: { leadId: { $in: leadIds }, channel: 'whatsapp' } },
			{ $sort: { createdAt: -1 } },
			{ $group: { _id: '$leadId', last: { $first: '$$ROOT' } } },
		])

		const lastMsgMap = new Map(lastMessages.map((r) => [String(r._id), r.last]))

		const unreadCounts = await EmailLog.aggregate([
			{
				$match: {
					leadId: { $in: leadIds },
					channel: 'whatsapp',
					type: 'incoming',
					deliveryStatus: { $ne: 'read' },
				},
			},
			{ $group: { _id: '$leadId', count: { $sum: 1 } } },
		])
		const unreadMap = new Map(
			unreadCounts.map((r) => [String(r._id), r.count as number]),
		)

		const conversations = leads.map((lead) => ({
			lead,
			lastMessage: lastMsgMap.get(String(lead._id)) ?? null,
			unreadCount: unreadMap.get(String(lead._id)) ?? 0,
		}))

		const total = await Lead.countDocuments(leadFilter)

		res.json({
			success: true,
			data: {
				conversations,
				pagination: {
					page: pageNum,
					limit: limitNum,
					total,
					pages: Math.ceil(total / limitNum),
				},
			},
		})
	} catch (error) {
		next(error)
	}
}

// ─── Get Messages for a Lead ──────────────────────────────────────────────────

export const getLeadMessages = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const userId = req.user!.userId
		const organizationId = req.user!.organizationId?.toString() ?? null
		const { leadId } = req.params
		const {
			channel,
			page = '1',
			limit = '50',
		} = req.query as Record<string, string>

		const pageNum = Math.max(1, parseInt(page, 10))
		const limitNum = Math.min(100, parseInt(limit, 10))
		const skip = (pageNum - 1) * limitNum

		const leadFilter = organizationId
			? { _id: leadId, organizationId }
			: { _id: leadId, userId }
		const lead = await Lead.findOne(leadFilter).lean()
		if (!lead) {
			res.status(404).json({ success: false, message: 'Lead not found' })
			return
		}

		const msgFilter: Record<string, unknown> = { leadId }
		if (channel) msgFilter.channel = channel

		const [messages, total] = await Promise.all([
			EmailLog.find(msgFilter)
				.sort({ sentAt: 1, createdAt: 1 })
				.skip(skip)
				.limit(limitNum)
				.lean(),
			EmailLog.countDocuments(msgFilter),
		])

		res.json({
			success: true,
			data: {
				messages,
				pagination: {
					page: pageNum,
					limit: limitNum,
					total,
					pages: Math.ceil(total / limitNum),
				},
			},
		})
	} catch (error) {
		next(error)
	}
}

export default {
	getEmbeddedSignupConfig,
	completeEmbeddedSignup,
	disconnectWhatsApp,
	getWhatsAppStatus,
	sendWhatsAppMessage,
	getWhatsAppConversations,
	getLeadMessages,
}
