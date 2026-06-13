import { Job, Queue, Worker } from 'bullmq'
import crypto from 'crypto'
import { config } from '../config'
import { BusinessType } from '../config/leadProfiles'
import { BACKEND_MANAGED_TYPES } from '../config/workflowCatalogue'
import { EmailLog } from '../models/EmailLog'
import { GmailConnection } from '../models/GmailConnection'
import { Lead } from '../models/Lead'
import { Settings } from '../models/Settings'
import { User } from '../models/User'
import { Workflow } from '../models/Workflow'
import logger from '../utils/logger'
// Two extractors with the same domain name but very different internals:
// - aiExtract: Gemini spam pre-filter → Claude Haiku structured extraction (async, can throw)
// - legacyExtract: pure regex fallback used only when aiExtract throws (sync, never throws)
import { extractLeadFromEmail as aiExtract } from './aiService'
import { buildAutoReplyPayload, sendAutoReply } from './emailService'
import { processNewEmails } from './gmailService'
import { extractLeadFromEmail as legacyExtract } from './leadExtractionService'
import { triggerWebhook } from './n8nService'
import { createNotification } from './notificationService'
import { isSpam } from './spamFilter'

const PLAN_LIMITS: Record<string, number> = {
	free: 30,
	basic: 500,
	pro: Infinity,
}

const redisConnection = {
	host: new URL(config.redis.url).hostname,
	port: parseInt(new URL(config.redis.url).port || '6379', 10),
}

// ─── Queues ──────────────────────────────────────────────────────────────────

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

export const crmSyncQueue = new Queue('crm-sync', {
	connection: redisConnection,
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: 'exponential', delay: 5000 },
	},
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function leadFingerprint(
	email: string,
	phone: string,
	businessType: string,
): string {
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

	const count = await Lead.countDocuments({
		userId,
		createdAt: { $gte: monthStart },
	})
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
			logger.error(`Gmail connection not found or inactive for user ${userId}`)
			throw new Error('Gmail connection not found or inactive')
		}

		const messages = await processNewEmails(gmailConnection)
		logger.info(`Found ${messages.length} new emails for user ${userId}`)

		for (const message of messages) {
			// Duplicate check: look for an existing EmailLog.
			// status='pending' means a previous run created the log but queue.add failed —
			// re-queue it now. status='delivered' means it was successfully queued before — skip.
			const existingLog = await EmailLog.findOne({
				userId,
				gmailMessageId: message.id,
				type: 'incoming',
			})
			if (existingLog) {
				if (existingLog.status === 'delivered') {
					logger.debug(`Email ${message.id} already queued for extraction, skipping`)
					continue
				}
				// status='pending': queue.add failed on a previous attempt — retry
				logger.warn(
					`Email ${message.id} has EmailLog but was never queued — re-queuing now`,
				)
				await leadExtractionQueue.add('extract-lead', {
					userId,
					gmailConnectionId,
					emailLogId: existingLog._id,
					messageId: message.id,
					subject: existingLog.subject,
					textBody: existingLog.body,
					htmlBody: existingLog.htmlBody,
					fromEmail: existingLog.from,
				})
				await EmailLog.findByIdAndUpdate(existingLog._id, {
					status: 'delivered',
				})
				continue
			}

			// New email — create log with 'pending' first, update to 'delivered' only
			// after queue.add succeeds. This keeps them atomic: if queue.add fails and
			// the worker retries, the 'pending' log above will re-queue correctly.
			const emailLog = await EmailLog.create({
				userId,
				type: 'incoming',
				from: message.fromEmail,
				to: message.to,
				subject: message.subject,
				body: message.textBody,
				htmlBody: message.htmlBody,
				gmailMessageId: message.id,
				status: 'pending',
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

			await EmailLog.findByIdAndUpdate(emailLog._id, { status: 'delivered' })
		}

		return { processed: messages.length }
	},
	{ connection: redisConnection, concurrency: 2 },
)

// ─── Lead Extraction Worker ───────────────────────────────────────────────────

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
		console.log('this is job data in the lead extraction worker:', job.data)

		// Plan limit check before any processing
		if (!(await isWithinPlanLimit(userId))) {
			logger.info(`Lead limit reached for user ${userId} — skipping`)
			return { skipped: 'plan_limit' }
		}

		const settings = await Settings.findOne({ userId })
		const businessType = (settings?.businessType || 'general') as BusinessType
		const minConfidence = settings?.minimumConfidence || 30
		const emailBody = textBody || htmlBody || ''

		// ── Gate: lead_extraction workflow must be installed AND active ──────────
		// Accepts both the backend-managed 'lead_extraction' type and the template
		// 'webhook_lead_trigger' type — both represent "lead processing is enabled".
		const orgIdForGates = settings?.organizationId ?? null
		console.log(orgIdForGates)

		const leWorkflow = orgIdForGates
			? await Workflow.findOne({
					organizationId: orgIdForGates,
					type: { $in: ['lead_extraction', 'webhook_lead_trigger'] },
				})
			: await Workflow.findOne({
					userId,
					type: { $in: ['lead_extraction', 'webhook_lead_trigger'] },
				})
		console.log(leWorkflow)

		if (!leWorkflow || !leWorkflow.isActive) {
			logger.warn(
				`Lead extraction skipped — workflow not installed or inactive (user ${userId}, orgId ${orgIdForGates ?? 'none'})`,
			)
			return { skipped: 'lead_extraction_disabled' }
		}

		// ── Gate: spam_filtering workflow must be installed AND active ────────
		const spamWorkflow = orgIdForGates
			? await Workflow.findOne({
					organizationId: orgIdForGates,
					type: 'spam_filtering',
				})
			: await Workflow.findOne({ userId, type: 'spam_filtering' })
		if (spamWorkflow?.isActive && isSpam(emailBody, fromEmail, businessType)) {
			logger.warn(
				`Spam filtered for user ${userId}: ${subject} (from: ${fromEmail})`,
			)
			return { isLead: false, reason: 'spam' }
		}

		logger.info(
			`Running AI extraction for user ${userId}: "${subject}" from ${fromEmail}`,
		)

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

		// Primary path: AI extraction. Falls back to regex below if this throws.
		try {
			const aiResult = await aiExtract(
				emailBody,
				fromEmail,
				businessType,
				userId,
				subject,
			)

			// null = Gemini pre-classified as spam, skip entirely
			if (aiResult === null) {
				logger.warn(
					`Gemini classified as spam — skipped (user ${userId}): "${subject}" from ${fromEmail}`,
				)
				return { isLead: false, reason: 'spam' }
			}

			if (!aiResult.isLead) {
				logger.info(
					`AI: not a lead for user ${userId}: "${subject}" from ${fromEmail}`,
				)
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
			// Fallback path: AI is unavailable (API error/timeout) — regex parser never throws
			logger.warn(`AI extraction failed, using fallback for ${userId}:`, aiErr)
			const fallback = legacyExtract(
				subject,
				textBody,
				htmlBody,
				fromEmail,
				userId,
				messageId,
			)

			if (!fallback.isLead || fallback.confidence < minConfidence) {
				logger.debug(
					`Fallback: not a lead (confidence ${fallback.confidence}): ${subject}`,
				)
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
			await Lead.updateOne(
				{ _id: existingByFp._id },
				{ $addToSet: { duplicateEmailIds: messageId } },
			)
			logger.warn(`Duplicate lead (fingerprint) skipped: ${messageId}`)
			return { isLead: true, duplicate: true }
		}

		// Also check by rawEmailId for exact-match dedup
		const existingByEmail = await Lead.findOne({
			userId,
			rawEmailId: messageId,
		})
		if (existingByEmail) {
			logger.warn(`Duplicate lead (emailId) skipped: ${messageId}`)
			return { isLead: true, duplicate: true }
		}

		const lead = await Lead.create({
			userId,
			organizationId: orgIdForGates,
			source: 'email',
			rawEmailId: messageId,
			rawEmailSubject: subject,
			rawEmailFrom: fromEmail,
			customerName,
			customerEmail,
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

		// Load all active workflows for this org to drive feature toggles
		const activeWorkflows = orgIdForGates
			? await Workflow.find({ organizationId: orgIdForGates, isActive: true })
			: await Workflow.find({ userId, isActive: true })

		const hasActiveWorkflow = (type: string) =>
			activeWorkflows.some((w) => w.type === type)

		// ── Gate: notification workflow must be installed AND active ──────────
		// Also fires when 'slack_notification' or 'webhook_lead_trigger' is active —
		// all three represent intent to be notified of new leads.
		if (
			hasActiveWorkflow('notification') ||
			hasActiveWorkflow('slack_notification') ||
			hasActiveWorkflow('webhook_lead_trigger')
		) {
			await createNotification(
				userId,
				'new_lead',
				'New Lead Detected',
				`${customerName || customerEmail} — score ${aiScore ?? confidence}`,
				String(lead._id),
			)
		}

		// ── Gate: auto_reply workflow must be installed AND active ────────────
		// Legacy settings.autoReply fallback is intentionally removed. The workflow
		// record is the single source of truth.
		const autoReplyWorkflow = activeWorkflows.find(
			(w) => w.type === 'auto_reply' || w.type === 'webhook_auto_reply',
		)
		if (autoReplyWorkflow && customerEmail) {
			const templateId =
				autoReplyWorkflow.config?.templateId?.toString() ?? null
			const useAiReply = Boolean(autoReplyWorkflow.config?.useAiReply)
			logger.info(
				`Queueing send-auto-reply for lead ${lead._id} with workflow ${autoReplyWorkflow.type}, template ${templateId ?? 'none'}, useAiReply=${useAiReply}`,
			)
			await autoReplyQueue.add('send-auto-reply', {
				leadId: lead._id,
				userId,
				gmailConnectionId,
				templateId,
				useAiReply,
			})
		} else {
			logger.warn(
				`Auto-reply | webhook_auto_reply skipped for lead ${lead._id}: workflowFound=${!!autoReplyWorkflow} isActive=${autoReplyWorkflow?.isActive ?? false} hasEmail=${!!customerEmail}`,
			)
		}

		// ── Gate: crm_sync workflow ──────────────────────────────────────────────
		const crmSyncWorkflow = activeWorkflows.find((w) => w.type === 'crm_sync')
		if (crmSyncWorkflow && crmSyncWorkflow.config?.crmUrl) {
			await crmSyncQueue.add('crm-sync-lead', {
				leadId: lead._id,
				userId,
				workflowId: crmSyncWorkflow._id,
			})
		}

		// Custom/n8n workflows — skip all backend-managed types to prevent double execution
		for (const workflow of activeWorkflows) {
			if (workflow.webhookUrl && !BACKEND_MANAGED_TYPES.has(workflow.type)) {
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
		const { leadId, userId, gmailConnectionId, templateId, useAiReply } = job.data

		const [lead, gmailConnection, settings] = await Promise.all([
			Lead.findById(leadId),
			GmailConnection.findById(gmailConnectionId),
			Settings.findOne({ userId }),
		])

		if (!lead) throw new Error('Lead not found')
		// gmailConnection may be null — sendAutoReply tries SMTP first, Gmail is only the fallback
		if (lead.autoReplySent) {
			logger.debug(`Auto-reply already sent for lead ${leadId}`)
			return { skipped: true }
		}

		const result = await sendAutoReply(
			lead,
			gmailConnection,
			settings || undefined,
			userId,
			templateId || null,
			Boolean(useAiReply),
		)

		if (result.success) {
			const emailLog = await EmailLog.create({
				userId,
				leadId: lead._id,
				type: 'outgoing',
				from: gmailConnection?.email ?? '',
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
			logger.error(
				`Failed to send auto-reply | webhook_auto_reply for lead ${leadId}: ${result.error}`,
			)
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

		if (
			workflow.type === 'auto_reply' ||
			workflow.type === 'webhook_auto_reply'
		) {
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
			payload = { ...autoReplyPayload, userId }
		} else {
			payload = {
				isLead: true,
				userId,
				leadId,
				customerName: lead.customerName,
				customerEmail: lead.customerEmail,
				customerPhone: lead.customerPhone,
				businessType: (lead as unknown as { businessType?: string })
					.businessType,
				aiScore: (lead as unknown as { aiScore?: number }).aiScore,
				sentiment: (lead as unknown as { sentiment?: string }).sentiment,
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

// ─── CRM Sync Worker ─────────────────────────────────────────────────────────

const crmSyncWorker = new Worker(
	'crm-sync',
	async (job: Job) => {
		const { leadId, userId, workflowId } = job.data

		const [lead, workflow] = await Promise.all([
			Lead.findById(leadId).lean(),
			Workflow.findById(workflowId),
		])

		if (!lead || !workflow) throw new Error('Lead or workflow not found')

		const crmUrl = workflow.config?.crmUrl as string | undefined
		if (!crmUrl) throw new Error('CRM URL not configured')

		const crmApiKey = workflow.config?.crmApiKey as string | undefined

		const payload = {
			leadId: String(lead._id),
			customerName: lead.customerName,
			customerEmail: lead.customerEmail,
			customerPhone: lead.customerPhone,
			status: lead.status,
			aiScore: (lead as unknown as { aiScore?: number }).aiScore,
			confidence: lead.confidence,
			sentiment: (lead as unknown as { sentiment?: string }).sentiment,
			businessType: (lead as unknown as { businessType?: string }).businessType,
			createdAt: lead.createdAt,
		}

		const headers: Record<string, string> = { 'Content-Type': 'application/json' }
		if (crmApiKey) headers['Authorization'] = `Bearer ${crmApiKey}`

		const response = await fetch(crmUrl, {
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
		})

		if (!response.ok) {
			const body = await response.text().catch(() => '')
			throw new Error(`CRM responded ${response.status}: ${body.slice(0, 200)}`)
		}

		await Workflow.findByIdAndUpdate(workflowId, {
			$inc: { triggerCount: 1 },
			lastTriggered: new Date(),
		})

		await createNotification(
			userId,
			'workflow_triggered',
			'CRM Sync',
			`Lead ${lead.customerName} pushed to CRM`,
			String(lead._id),
		)

		return { success: true }
	},
	{ connection: redisConnection, concurrency: 5 },
)

// ─── Error handlers ───────────────────────────────────────────────────────────

;[
	emailProcessingWorker,
	leadExtractionWorker,
	autoReplyWorker,
	n8nTriggerWorker,
	crmSyncWorker,
].forEach((worker) => {
	worker.on('failed', (job, err) =>
		logger.error(`Job ${job?.id} in ${worker.name} failed:`, err),
	)
	worker.on('completed', (job) =>
		logger.debug(`Job ${job.id} in ${worker.name} completed`),
	)
})

// ─── Public helpers ───────────────────────────────────────────────────────────

export const addEmailProcessingJob = async (
	userId: string,
	gmailConnectionId: string,
) => {
	const job = await emailProcessingQueue.add(
		'process-emails',
		{ userId, gmailConnectionId },
		{ jobId: `process-${userId}-${Date.now()}` },
	)
	logger.info(`Email processing job queued for user ${userId}, job ${job.id}`)
	return job
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
