import { Job, Queue, Worker } from 'bullmq'
import { config } from '../config'
import { EmailLog } from '../models/EmailLog'
import { GmailConnection } from '../models/GmailConnection'
import { Lead } from '../models/Lead'
import { Settings } from '../models/Settings'
import { Workflow } from '../models/Workflow'
import logger from '../utils/logger'
import { buildAutoReplyPayload, sendAutoReply } from './emailService'
import { processNewEmails } from './gmailService'
import { extractLeadFromEmail } from './leadExtractionService'
import { triggerWebhook } from './n8nService'
import { createNotification } from './notificationService'

const redisConnection = {
	host: new URL(config.redis.url).hostname,
	port: parseInt(new URL(config.redis.url).port || '6379', 10),
}

// Queues
export const emailProcessingQueue = new Queue('email-processing', {
	connection: redisConnection,
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: 'exponential', delay: 5000 },
	},
})

export const leadExtractionQueue = new Queue('lead-extraction', {
	connection: redisConnection,
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: 'exponential', delay: 3000 },
	},
})

export const autoReplyQueue = new Queue('auto-reply', {
	connection: redisConnection,
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: 'exponential', delay: 5000 },
	},
})

export const n8nTriggerQueue = new Queue('n8n-trigger', {
	connection: redisConnection,
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: 'exponential', delay: 3000 },
	},
})

// Email Processing Worker
const emailProcessingWorker = new Worker(
	'email-processing',
	async (job: Job) => {
		const { userId, gmailConnectionId } = job.data
		logger.info(`Processing emails for user ${userId}`)

		const gmailConnection = await GmailConnection.findById(gmailConnectionId)
		if (!gmailConnection || !gmailConnection.isActive) {
			throw new Error('Gmail connection not found or inactive')
		}

		const messages = await processNewEmails(gmailConnection)
		logger.info(`Found ${messages.length} new emails for user ${userId}`)

		for (const message of messages) {
			// Log incoming email
			const emailLog = await EmailLog.create({
				userId,
				type: 'incoming',
				from: message.fromEmail,
				to: message.to,
				subject: message.subject,
				body: message.textBody,
				htmlBody: message.htmlBody,
				gmailMessageId: message.id,
				status: 'delivered',
				sentAt: message.date,
			})

			// Queue lead extraction
			await leadExtractionQueue.add('extract-lead', {
				userId,
				gmailConnectionId,
				emailLogId: emailLog._id,
				messageId: message.id,
				subject: message.subject,
				textBody: message.textBody,
				htmlBody: message.htmlBody,
				fromEmail: message.fromEmail,
			})
		}

		return { processed: messages.length }
	},
	{ connection: redisConnection, concurrency: 2 },
)

// Lead Extraction Worker
const leadExtractionWorker = new Worker(
	'lead-extraction',
	async (job: Job) => {
		const {
			userId,
			gmailConnectionId,
			emailLogId,
			messageId,
			subject,
			textBody,
			htmlBody,
			fromEmail,
		} = job.data

		const settings = await Settings.findOne({ userId })
		const minConfidence = settings?.minimumConfidence || 30

		const result = extractLeadFromEmail(
			subject,
			textBody,
			htmlBody,
			fromEmail,
			userId,
			messageId,
		)

		if (!result.isLead || result.confidence < minConfidence) {
			logger.debug(
				`Email not a lead (confidence: ${result.confidence}): ${subject}`,
			)
			return { isLead: false }
		}

		// Check for duplicate
		const existing = await Lead.findOne({ userId, rawEmailId: messageId })
		if (existing) {
			logger.debug(`Duplicate lead skipped: ${messageId}`)
			return { isLead: true, duplicate: true }
		}

		const lead = await Lead.create({
			...result.leadData,
			emailLogId,
		})

		await EmailLog.findByIdAndUpdate(emailLogId, { leadId: lead._id })

		logger.info(`Lead created: ${lead._id} from ${fromEmail}`)

		await createNotification(
			userId,
			'new_lead',
			'New Lead Detected',
			`${lead.customerName} — ${(lead.services ?? []).join(', ')} from ${lead.fromAddress}`,
			String(lead._id),
		)

		// Queue auto-reply if enabled
		if (settings?.autoReply && result.leadData.customerEmail) {
			await autoReplyQueue.add('send-auto-reply', {
				leadId: lead._id,
				userId,
				gmailConnectionId,
			})
		}

		// Queue n8n trigger
		const activeWorkflows = await Workflow.find({ userId, isActive: true })
		for (const workflow of activeWorkflows) {
			if (workflow.webhookUrl) {
				await n8nTriggerQueue.add('trigger-n8n', {
					leadId: lead._id,
					userId,
					workflowId: workflow._id,
					webhookUrl: workflow.webhookUrl,
				})
			}
		}

		return { isLead: true, leadId: lead._id }
	},
	{ connection: redisConnection, concurrency: 3 },
)

// Auto Reply Worker
const autoReplyWorker = new Worker(
	'auto-reply',
	async (job: Job) => {
		const { leadId, userId, gmailConnectionId } = job.data

		const [lead, gmailConnection, settings] = await Promise.all([
			Lead.findById(leadId),
			GmailConnection.findById(gmailConnectionId),
			Settings.findOne({ userId }),
		])

		if (!lead || !gmailConnection) {
			throw new Error('Lead or Gmail connection not found')
		}

		if (lead.autoReplySent) {
			logger.debug(`Auto-reply already sent for lead ${leadId}`)
			return { skipped: true }
		}

		const result = await sendAutoReply(
			lead,
			gmailConnection,
			settings || undefined,
			userId,
		)

		if (result.success) {
			const emailLog = await EmailLog.create({
				userId,
				leadId: lead._id,
				type: 'outgoing',
				from: gmailConnection.email,
				to: lead.customerEmail,
				subject: settings?.autoReplySubject || 'Thank you for your enquiry!',
				body: '',
				status: 'sent',
				gmailMessageId: result.messageId || '',
				sentAt: new Date(),
			})

			await Lead.findByIdAndUpdate(leadId, {
				autoReplySent: true,
				autoReplySentAt: new Date(),
				emailLogId: emailLog._id,
			})

			logger.info(`Auto-reply sent for lead ${leadId} to ${lead.customerEmail}`)

			await createNotification(
				userId,
				'auto_reply_sent',
				'Auto Reply Sent',
				`Reply sent to ${lead.customerName} (${lead.customerEmail})`,
				String(lead._id),
			)
		} else {
			logger.error(
				`Failed to send auto-reply for lead ${leadId}: ${result.error}`,
			)
			throw new Error(result.error)
		}

		return { success: true }
	},
	{ connection: redisConnection, concurrency: 2 },
)

// n8n Trigger Worker
const n8nTriggerWorker = new Worker(
	'n8n-trigger',
	async (job: Job) => {
		const { leadId, userId, workflowId, webhookUrl } = job.data

		const [lead, workflow, settings] = await Promise.all([
			Lead.findById(leadId).lean(),
			Workflow.findById(workflowId),
			Settings.findOne({ userId }).lean(),
		])

		if (!lead || !workflow) throw new Error('Lead or workflow not found')

		let payload: Record<string, unknown>

		if (workflow.type === 'auto_reply') {
			const gmailConnection = await GmailConnection.findOne({
				userId,
				isActive: true,
			})
			const autoReplyPayload = await buildAutoReplyPayload(
				lead as never,
				{ ...workflow.config, workflowId: workflow._id.toString() },
				settings as never,
				gmailConnection?.email ?? '',
			)
			// userId lets n8n call POST /api/email/send using the user's own credentials
			payload = { ...autoReplyPayload, userId }
		} else {
			payload = {
				userId,
				leadId,
				customerName: lead.customerName,
				customerEmail: lead.customerEmail,
				customerPhone: lead.customerPhone,
				movingDate: lead.movingDate,
				fromAddress: lead.fromAddress,
				toAddress: lead.toAddress,
				services: lead.services,
				notes: lead.notes,
				status: lead.status,
				confidence: lead.confidence,
				createdAt: lead.createdAt,
			}
		}

		const result = await triggerWebhook(webhookUrl, payload)

		if (result.success) {
			await Lead.findByIdAndUpdate(leadId, {
				n8nTriggered: true,
				n8nTriggeredAt: new Date(),
			})

			await Workflow.findByIdAndUpdate(workflowId, {
				$inc: { triggerCount: 1 },
				lastTriggered: new Date(),
			})

			await createNotification(
				userId,
				'workflow_triggered',
				'Workflow Triggered',
				`n8n workflow fired for ${lead.customerName}`,
				String(lead._id),
			)
		}

		return result
	},
	{ connection: redisConnection, concurrency: 5 },
)

// Error handlers
;[
	emailProcessingWorker,
	leadExtractionWorker,
	autoReplyWorker,
	n8nTriggerWorker,
].forEach((worker) => {
	worker.on('failed', (job, err) => {
		logger.error(`Job ${job?.id} in queue ${worker.name} failed:`, err)
	})
	worker.on('completed', (job) => {
		logger.debug(`Job ${job.id} in queue ${worker.name} completed`)
	})
})

export const addEmailProcessingJob = async (
	userId: string,
	gmailConnectionId: string,
) => {
	return emailProcessingQueue.add(
		'process-emails',
		{ userId, gmailConnectionId },
		{
			jobId: `process-${userId}-${Date.now()}`,
		},
	)
}

export const getQueueStats = async () => {
	const [emailStats, leadStats, replyStats, n8nStats] = await Promise.all([
		emailProcessingQueue.getJobCounts(),
		leadExtractionQueue.getJobCounts(),
		autoReplyQueue.getJobCounts(),
		n8nTriggerQueue.getJobCounts(),
	])

	return {
		emailProcessing: emailStats,
		leadExtraction: leadStats,
		autoReply: replyStats,
		n8nTrigger: n8nStats,
	}
}

export default {
	emailProcessingQueue,
	leadExtractionQueue,
	autoReplyQueue,
	n8nTriggerQueue,
	addEmailProcessingJob,
	getQueueStats,
}
