/**
 * BullMQ queues and workers for WhatsApp message processing.
 *
 * Mirrors the pattern in queueService.ts — two separate queues:
 *   whatsappProcessingQueue  → incoming messages (find/create lead, auto-reply)
 *   whatsappStatusQueue      → delivery status updates (sent/delivered/read/failed)
 */

import { Job, Queue, Worker } from 'bullmq'
import { config } from '../config'
import { EmailLog } from '../models/EmailLog'
import { Lead } from '../models/Lead'
import { WhatsAppConnection } from '../models/WhatsAppConnection'
import { Workflow } from '../models/Workflow'
import { Settings } from '../models/Settings'
import { WAIncomingMessage, WAStatusUpdate, sendTextMessage } from './whatsappService'
import { decrypt } from '../utils/encryption'
import { createNotification } from './notificationService'
import { emitToUser, emitToOrg } from './socketService'
import logger from '../utils/logger'

const redisConnection = {
	host: new URL(config.redis.url).hostname,
	port: parseInt(new URL(config.redis.url).port || '6379', 10),
}

// ─── Queues ───────────────────────────────────────────────────────────────────

export const whatsappProcessingQueue = new Queue('whatsapp-processing', {
	connection: redisConnection,
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: 'exponential', delay: 5000 },
	},
})

export const whatsappStatusQueue = new Queue('whatsapp-status', {
	connection: redisConnection,
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: 'exponential', delay: 3000 },
	},
})

// ─── Phone normalisation ──────────────────────────────────────────────────────

/** Strips all non-digits for comparison. Handles both +15551234567 and 15551234567 */
const normalizePhone = (phone: string) => phone.replace(/\D/g, '')

/** Formats to E.164 with leading + for storage */
const toE164 = (phone: string) => {
	const digits = normalizePhone(phone)
	return digits.startsWith('+') ? digits : `+${digits}`
}

// ─── Incoming Message Worker ──────────────────────────────────────────────────

const whatsappProcessingWorker = new Worker(
	'whatsapp-processing',
	async (job: Job) => {
		const {
			phoneNumberId,
			wabaId,
			message,
			userId,
			organizationId,
		}: {
			phoneNumberId: string
			wabaId: string
			message: WAIncomingMessage
			userId: string
			organizationId: string | null
		} = job.data

		logger.info(`Processing WA message ${message.messageId} from ${message.from}`)

		// Idempotency: skip if already processed
		const existing = await EmailLog.findOne({ whatsappMessageId: message.messageId })
		if (existing) {
			logger.debug(`WA message ${message.messageId} already processed — skipping`)
			return { skipped: 'duplicate' }
		}

		// Find WhatsApp connection to get decrypted credentials
		const connection = await WhatsAppConnection.findOne({ phoneNumberId, isActive: true })
		if (!connection) {
			throw new Error(`No active WhatsApp connection for phoneNumberId ${phoneNumberId}`)
		}

		const senderPhone = toE164(message.from)
		const senderNorm = normalizePhone(message.from)

		// ── Find existing lead by phone ──────────────────────────────────────
		const leadQuery = organizationId
			? { organizationId, $or: [{ customerPhone: { $regex: senderNorm } }] }
			: { userId, $or: [{ customerPhone: { $regex: senderNorm } }] }

		let lead = await Lead.findOne(leadQuery).sort({ createdAt: -1 })

		// ── Create lead if none found ────────────────────────────────────────
		if (!lead) {
			lead = await Lead.create({
				userId,
				organizationId: organizationId ?? null,
				source: 'whatsapp',
				rawEmailId: '',
				customerName: message.senderName || senderPhone,
				customerEmail: '',
				customerPhone: senderPhone,
				notes: '',
				status: 'new',
				confidence: 70,  // WhatsApp leads have explicit intent
				aiProcessed: false,
			})

			// Notify if notification workflow active
			const notifyWf = organizationId
				? await Workflow.findOne({
						organizationId,
						type: { $in: ['notification', 'whatsapp_lead_trigger', 'webhook_lead_trigger'] },
						isActive: true,
					})
				: await Workflow.findOne({
						userId,
						type: { $in: ['notification', 'whatsapp_lead_trigger', 'webhook_lead_trigger'] },
						isActive: true,
					})

			if (notifyWf) {
				await createNotification(
					userId,
					'new_lead',
					'New WhatsApp Lead',
					`${message.senderName || senderPhone} sent a WhatsApp message`,
					String(lead._id),
				)
			}

			// Emit new lead event
			const leadPlain = lead.toJSON()
			if (organizationId) emitToOrg(organizationId, 'lead:new', leadPlain)
			emitToUser(userId, 'lead:new', leadPlain)

			logger.info(`New WhatsApp lead created: ${lead._id}`)
		}

		// ── Store message as EmailLog (channel: 'whatsapp') ──────────────────
		const messageBody =
			message.type === 'text'
				? (message.text ?? '')
				: `[${message.type}${message.mediaCaption ? `: ${message.mediaCaption}` : ''}]`

		const emailLog = await EmailLog.create({
			userId,
			leadId: lead._id,
			channel: 'whatsapp',
			type: 'incoming',
			from: senderPhone,
			to: connection.displayPhoneNumber,
			subject: '',
			body: messageBody,
			htmlBody: '',
			whatsappMessageId: message.messageId,
			whatsappPhone: senderPhone,
			messageType: message.type,
			mediaUrl: null,
			deliveryStatus: null,
			status: 'delivered',
			sentAt: new Date(parseInt(message.timestamp, 10) * 1000),
		})

		// Update lead last-contact time
		await WhatsAppConnection.findByIdAndUpdate(connection._id, {
			$inc: { messageCount: 1 },
			lastMessageAt: new Date(),
		})

		// Emit real-time message event
		const msgPayload = {
			leadId: String(lead._id),
			emailLogId: String(emailLog._id),
			channel: 'whatsapp',
			type: 'incoming',
			from: senderPhone,
			body: messageBody,
			messageType: message.type,
			timestamp: emailLog.sentAt,
			senderName: message.senderName,
		}
		if (organizationId) emitToOrg(organizationId, 'whatsapp:message:new', msgPayload)
		emitToUser(userId, 'whatsapp:message:new', msgPayload)

		// ── Auto-reply via whatsapp_auto_reply workflow ──────────────────────
		const autoReplyWf = organizationId
			? await Workflow.findOne({
					organizationId,
					type: 'whatsapp_auto_reply',
					isActive: true,
				})
			: await Workflow.findOne({
					userId,
					type: 'whatsapp_auto_reply',
					isActive: true,
				})

		if (autoReplyWf) {
			const settings = await Settings.findOne({ userId })
			const replyText: string =
				(autoReplyWf.config as Record<string, unknown>)?.whatsappReplyText as string ||
				settings?.autoReplySubject ||
				'Thank you for your message! We will get back to you shortly.'

			const accessToken = decrypt(connection.accessToken)
			const result = await sendTextMessage(
				connection.phoneNumberId,
				accessToken,
				message.from,
				replyText,
			)

			if (result.success && result.messageId) {
				await EmailLog.create({
					userId,
					leadId: lead._id,
					channel: 'whatsapp',
					type: 'outgoing',
					from: connection.displayPhoneNumber,
					to: senderPhone,
					subject: '',
					body: replyText,
					htmlBody: '',
					whatsappMessageId: result.messageId,
					whatsappPhone: senderPhone,
					messageType: 'text',
					deliveryStatus: 'sent',
					status: 'sent',
					sentAt: new Date(),
				})

				const replyPayload = {
					leadId: String(lead._id),
					channel: 'whatsapp',
					type: 'outgoing',
					body: replyText,
					messageType: 'text',
					timestamp: new Date(),
				}
				if (organizationId) emitToOrg(organizationId, 'whatsapp:message:new', replyPayload)
				emitToUser(userId, 'whatsapp:message:new', replyPayload)

				logger.info(`WhatsApp auto-reply sent for lead ${lead._id}`)
			}
		}

		return { success: true, leadId: String(lead._id), emailLogId: String(emailLog._id) }
	},
	{ connection: redisConnection, concurrency: 3 },
)

// ─── Status Update Worker ─────────────────────────────────────────────────────

const whatsappStatusWorker = new Worker(
	'whatsapp-status',
	async (job: Job) => {
		const { status, userId, organizationId }: {
			status: WAStatusUpdate
			userId: string
			organizationId: string | null
		} = job.data

		const emailLog = await EmailLog.findOneAndUpdate(
			{ whatsappMessageId: status.messageId },
			{ deliveryStatus: status.status },
			{ new: true },
		)

		if (!emailLog) {
			logger.debug(`Status update for unknown WA messageId ${status.messageId} — skipping`)
			return { skipped: 'not_found' }
		}

		const statusPayload = {
			messageId: status.messageId,
			leadId: emailLog.leadId ? String(emailLog.leadId) : null,
			status: status.status,
			timestamp: new Date(parseInt(status.timestamp, 10) * 1000),
		}

		if (organizationId) emitToOrg(organizationId, 'whatsapp:message:status', statusPayload)
		emitToUser(userId, 'whatsapp:message:status', statusPayload)

		return { success: true }
	},
	{ connection: redisConnection, concurrency: 5 },
)

// ─── Error handlers ───────────────────────────────────────────────────────────

;[whatsappProcessingWorker, whatsappStatusWorker].forEach((worker) => {
	worker.on('failed', (job, err) =>
		logger.error(`WA Job ${job?.id} in ${worker.name} failed:`, err),
	)
	worker.on('completed', (job) =>
		logger.debug(`WA Job ${job.id} in ${worker.name} completed`),
	)
})

// ─── Public helpers ───────────────────────────────────────────────────────────

export const addWhatsAppMessageJob = async (params: {
	phoneNumberId: string
	wabaId: string
	message: WAIncomingMessage
	userId: string
	organizationId: string | null
}) => {
	// Use messageId as jobId for idempotency — duplicate webhooks from Meta are safe
	return whatsappProcessingQueue.add('process-wa-message', params, {
		jobId: `wa-msg-${params.message.messageId}`,
	})
}

export const addWhatsAppStatusJob = async (params: {
	status: WAStatusUpdate
	userId: string
	organizationId: string | null
}) => {
	return whatsappStatusQueue.add('wa-status', params, {
		jobId: `wa-status-${params.status.messageId}-${params.status.status}`,
	})
}

export const getWhatsAppQueueStats = async () => {
	const [msgStats, statusStats] = await Promise.all([
		whatsappProcessingQueue.getJobCounts(),
		whatsappStatusQueue.getJobCounts(),
	])
	return { whatsappProcessing: msgStats, whatsappStatus: statusStats }
}

export default {
	whatsappProcessingQueue,
	whatsappStatusQueue,
	addWhatsAppMessageJob,
	addWhatsAppStatusJob,
	getWhatsAppQueueStats,
}
