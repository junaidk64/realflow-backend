import crypto from 'crypto'
import { Job, Queue, Worker } from 'bullmq'
import { config } from '../config'
import { EmailLog } from '../models/EmailLog'
import { GmailConnection } from '../models/GmailConnection'
import { Lead } from '../models/Lead'
import { Settings } from '../models/Settings'
import { User } from '../models/User'
import { Workflow } from '../models/Workflow'
import logger from '../utils/logger'
import { buildAutoReplyPayload, sendAutoReply } from './emailService'
import { processNewEmails } from './gmailService'
import { extractLeadFromEmail as legacyExtract } from './leadExtractionService'
import { extractLeadFromEmail as aiExtract } from './aiService'
import { isSpam } from './spamFilter'
import { triggerWebhook } from './n8nService'
import { createNotification } from './notificationService'
import { BusinessType } from '../config/leadProfiles'

const PLAN_LIMITS: Record<string, number> = { free: 30, basic: 500, pro: Infinity }

const redisConnection = {
	host: new URL(config.redis.url).hostname,
	port: parseInt(new URL(config.redis.url).port || '6379', 10),
}

// ─── Queues ──────────────────────────────────────────────────────────────────

export const emailProcessingQueue = new Queue('email-processing', {
	connection: redisConnection,
	defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
})

export const leadExtractionQueue = new Queue('lead-extraction', {
	connection: redisConnection,
	defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
})

export const autoReplyQueue = new Queue('auto-reply', {
	connection: redisConnection,
	defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
})

export const n8nTriggerQueue = new Queue('n8n-trigger', {
	connection: redisConnection,
	defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function leadFingerprint(email: string, phone: string, businessType: string): string {
	const raw = `${email.toLowerCase()}|${phone.replace(/\D/g, '')}|${businessType}`
	return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

async function isWithinPlanLimit(userId: string): Promise<boolean> {
	const user = await User.findById(userId).lean()
	const plan = (user as { plan?: string } | null)?.plan || 'free'
	const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free

	const monthStart = new Date()
	monthStart.setDate(1)
	monthStart.setHours(0, 0, 0, 0)

	const count = await Lead.countDocuments({ userId, createdAt: { $gte: monthStart } })
	return count < limit
}

// ─── Email Processing Worker ──────────────────────────────────────────────────

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

// ─── Lead Extraction Worker ───────────────────────────────────────────────────

const leadExtractionWorker = new Worker(
	'lead-extraction',
	async (job: Job) => {
		const { userId, gmailConnectionId, emailLogId, messageId, subject, textBody, htmlBody, fromEmail } = job.data

		// Plan limit check before any processing
		if (!(await isWithinPlanLimit(userId))) {
			logger.info(`Lead limit reached for user ${userId} — skipping`)
			return { skipped: 'plan_limit' }
		}

		const settings = await Settings.findOne({ userId })
		const businessType = (settings?.businessType || 'general') as BusinessType
		const minConfidence = settings?.minimumConfidence || 30
		const emailBody = textBody || htmlBody || ''

		// Spam pre-filter — zero AI cost on junk
		if (isSpam(emailBody, fromEmail, businessType)) {
			logger.debug(`Spam filtered for user ${userId}: ${subject}`)
			return { isLead: false, reason: 'spam' }
		}

		// AI extraction (primary) with legacy regex as fallback
		let customerName = ''
		let customerEmail = fromEmail
		let customerPhone = ''
		let extractedFields: Record<string, unknown> = {}
		let aiScore: number | null = null
		let aiScoreReason: string | null = null
		let sentiment: 'positive' | 'neutral' | 'negative' | 'urgent' | null = null
		let isLead = false
		let confidence = 0

		try {
			const aiResult = await aiExtract(emailBody, fromEmail, businessType, userId)

			if (!aiResult.isLead) {
				logger.debug(`AI: not a lead for user ${userId}: ${subject}`)
				return { isLead: false, reason: 'not_a_lead' }
			}

			isLead = true
			customerName = aiResult.customerName || ''
			customerEmail = aiResult.customerEmail || fromEmail
			customerPhone = aiResult.customerPhone || ''
			extractedFields = aiResult.extractedFields
			aiScore = aiResult.aiScore
			aiScoreReason = aiResult.aiScoreReason
			sentiment = aiResult.sentiment
			confidence = aiResult.aiScore * 10
		} catch (aiErr) {
			// Fallback to legacy regex parser
			logger.warn(`AI extraction failed, using fallback for ${userId}:`, aiErr)
			const fallback = legacyExtract(subject, textBody, htmlBody, fromEmail, userId, messageId)

			if (!fallback.isLead || fallback.confidence < minConfidence) {
				logger.debug(`Fallback: not a lead (confidence ${fallback.confidence}): ${subject}`)
				return { isLead: false, reason: 'low_confidence' }
			}

			isLead = true
			customerName = fallback.leadData.customerName || ''
			customerEmail = fallback.leadData.customerEmail || fromEmail
			customerPhone = fallback.leadData.customerPhone || ''
			confidence = fallback.confidence
		}

		if (!isLead) return { isLead: false }

		// Fingerprint-based duplicate detection
		const fp = leadFingerprint(customerEmail, customerPhone, businessType)
		const existingByFp = await Lead.findOne({ userId, fingerprint: fp })
		if (existingByFp) {
			await Lead.updateOne({ _id: existingByFp._id }, { $addToSet: { duplicateEmailIds: messageId } })
			logger.debug(`Duplicate lead (fingerprint) skipped: ${messageId}`)
			return { isLead: true, duplicate: true }
		}

		// Also check by rawEmailId for exact-match dedup
		const existingByEmail = await Lead.findOne({ userId, rawEmailId: messageId })
		if (existingByEmail) {
			logger.debug(`Duplicate lead (emailId) skipped: ${messageId}`)
			return { isLead: true, duplicate: true }
		}

		const lead = await Lead.create({
			userId,
			source: 'email',
			rawEmailId: messageId,
			rawEmailSubject: subject,
			rawEmailFrom: fromEmail,
			customerName,
			customerEmail,
			customerPhone,
			businessType,
			extraFields: extractedFields,
			notes: '',
			status: 'new',
			confidence,
			aiScore,
			aiScoreReason,
			sentiment,
			aiProcessed: aiScore !== null,
			fingerprint: fp,
			emailLogId,
		})

		await EmailLog.findByIdAndUpdate(emailLogId, { leadId: lead._id })
		logger.info(`Lead created: ${lead._id} from ${fromEmail}`)

		await createNotification(
			userId,
			'new_lead',
			'New Lead Detected',
			`${customerName || customerEmail} — score ${aiScore ?? confidence}`,
			String(lead._id),
		)

		if (settings?.autoReply && customerEmail) {
			await autoReplyQueue.add('send-auto-reply', { leadId: lead._id, userId, gmailConnectionId })
		}

		const activeWorkflows = await Workflow.find({ userId, isActive: true })
		for (const workflow of activeWorkflows) {
			// auto_reply is handled by the backend directly — skip to prevent double-send
			if (workflow.webhookUrl && workflow.type !== 'auto_reply') {
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

// ─── Auto Reply Worker ────────────────────────────────────────────────────────

const autoReplyWorker = new Worker(
	'auto-reply',
	async (job: Job) => {
		const { leadId, userId, gmailConnectionId } = job.data

		const [lead, gmailConnection, settings] = await Promise.all([
			Lead.findById(leadId),
			GmailConnection.findById(gmailConnectionId),
			Settings.findOne({ userId }),
		])

		if (!lead || !gmailConnection) throw new Error('Lead or Gmail connection not found')
		if (lead.autoReplySent) {
			logger.debug(`Auto-reply already sent for lead ${leadId}`)
			return { skipped: true }
		}

		const result = await sendAutoReply(lead, gmailConnection, settings || undefined, userId)

		if (result.success) {
			const emailLog = await EmailLog.create({
				userId,
				leadId: lead._id,
				type: 'outgoing',
				from: gmailConnection.email,
				to: lead.customerEmail,
				subject: settings?.autoReplySubject || 'Thank you for your enquiry!',
				body: result.html || '',
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
			logger.error(`Failed to send auto-reply for lead ${leadId}: ${result.error}`)
			throw new Error(result.error)
		}

		return { success: true }
	},
	{ connection: redisConnection, concurrency: 2 },
)

// ─── n8n Trigger Worker ───────────────────────────────────────────────────────

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
			const gmailConnection = await GmailConnection.findOne({ userId, isActive: true })
			const autoReplyPayload = await buildAutoReplyPayload(
				lead as never,
				{ ...workflow.config, workflowId: workflow._id.toString() },
				settings as never,
				gmailConnection?.email ?? '',
			)
			payload = { ...autoReplyPayload, userId }
		} else {
			payload = {
				userId,
				leadId,
				customerName: lead.customerName,
				customerEmail: lead.customerEmail,
				customerPhone: lead.customerPhone,
				businessType: (lead as unknown as { businessType?: string }).businessType,
				aiScore: (lead as unknown as { aiScore?: number }).aiScore,
				sentiment: (lead as unknown as { sentiment?: string }).sentiment,
				status: lead.status,
				confidence: lead.confidence,
				createdAt: lead.createdAt,
			}
		}

		const result = await triggerWebhook(webhookUrl, payload)

		if (result.success) {
			await Lead.findByIdAndUpdate(leadId, { n8nTriggered: true, n8nTriggeredAt: new Date() })
			await Workflow.findByIdAndUpdate(workflowId, { $inc: { triggerCount: 1 }, lastTriggered: new Date() })
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

// ─── Error handlers ───────────────────────────────────────────────────────────

;[emailProcessingWorker, leadExtractionWorker, autoReplyWorker, n8nTriggerWorker].forEach((worker) => {
	worker.on('failed', (job, err) => logger.error(`Job ${job?.id} in ${worker.name} failed:`, err))
	worker.on('completed', (job) => logger.debug(`Job ${job.id} in ${worker.name} completed`))
})

// ─── Public helpers ───────────────────────────────────────────────────────────

export const addEmailProcessingJob = async (userId: string, gmailConnectionId: string) =>
	emailProcessingQueue.add(
		'process-emails',
		{ userId, gmailConnectionId },
		{ jobId: `process-${userId}-${Date.now()}` },
	)

export const getQueueStats = async () => {
	const [emailStats, leadStats, replyStats, n8nStats] = await Promise.all([
		emailProcessingQueue.getJobCounts(),
		leadExtractionQueue.getJobCounts(),
		autoReplyQueue.getJobCounts(),
		n8nTriggerQueue.getJobCounts(),
	])
	return { emailProcessing: emailStats, leadExtraction: leadStats, autoReply: replyStats, n8nTrigger: n8nStats }
}

export default { emailProcessingQueue, leadExtractionQueue, autoReplyQueue, n8nTriggerQueue, addEmailProcessingJob, getQueueStats }
