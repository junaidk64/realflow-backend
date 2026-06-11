import { NextFunction, Request, Response } from 'express'
import { GmailConnection } from '../models/GmailConnection'
import { Lead } from '../models/Lead'
import { WebhookLog } from '../models/WebhookLog'
import { WhatsAppConnection } from '../models/WhatsAppConnection'
import { Workflow } from '../models/Workflow'
import { addEmailProcessingJob } from '../services/queueService'
import {
	addWhatsAppMessageJob,
	addWhatsAppStatusJob,
} from '../services/whatsappQueueService'
import {
	parseWebhookPayload,
	verifyWebhookSignature,
} from '../services/whatsappService'
import config from '../config'
import logger from '../utils/logger'

export const handleGmailWebhook = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const body = req.body
		console.log('Received Gmail webhook:', JSON.stringify(body))
		const webhookLog = await WebhookLog.create({
			type: 'gmail_push',
			payload: body,
			status: 'received',
		})

		if (body.message?.data) {
			try {
				const decoded = JSON.parse(
					Buffer.from(body.message.data, 'base64').toString(),
				)
				const { emailAddress } = decoded

				if (emailAddress) {
					const connection = await GmailConnection.findOne({
						email: emailAddress,
						isActive: true,
					})
					if (connection) {
						await addEmailProcessingJob(
							connection.userId.toString(),
							connection._id.toString(),
						)

						await WebhookLog.findByIdAndUpdate(webhookLog._id, {
							status: 'processing',
							userId: connection.userId,
							processedAt: new Date(),
						})

						logger.info(
							`Gmail webhook processed for ${emailAddress},  ${JSON.stringify(body)}`,
						)
					}
				}
			} catch (parseError) {
				logger.error('Failed to parse Gmail webhook data:', parseError)
				await WebhookLog.findByIdAndUpdate(webhookLog._id, {
					status: 'failed',
					error: (parseError as Error).message,
				})
			}
		}

		// Always return 200 to acknowledge receipt
		res.status(200).json({ success: true })
	} catch (error) {
		logger.error('Gmail webhook handler error:', error)
		res.status(200).json({ success: true }) // Still ack to prevent retries
	}
}

export const handleN8nWebhook = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const body = req.body

		await WebhookLog.create({
			type: 'n8n_callback',
			payload: body,
			status: 'processed',
			processedAt: new Date(),
		})

		// Handle n8n status updates
		if (body.leadId && body.status) {
			await Lead.findByIdAndUpdate(body.leadId, { status: body.status })
		}

		res.json({ success: true })
	} catch (error) {
		next(error)
	}
}

export const getWebhookLogs = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const {
			page = '1',
			limit = '20',
			type,
			status,
		} = req.query as Record<string, string>

		const pageNum = Math.max(1, parseInt(page, 10))
		const limitNum = Math.min(100, parseInt(limit, 10))
		const skip = (pageNum - 1) * limitNum

		const filter: Record<string, unknown> = {}
		if (type) filter.type = type
		if (status) filter.status = status

		const [logs, total] = await Promise.all([
			WebhookLog.find(filter)
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limitNum)
				.lean(),
			WebhookLog.countDocuments(filter),
		])

		res.json({
			success: true,
			data: {
				logs,
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

export const handleN8nCallback = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { leadId, workflowId, status, error, eventType } = req.body

		await WebhookLog.create({
			type: 'n8n_callback',
			payload: req.body,
			status: 'processed',
			processedAt: new Date(),
		})

		const updates: Promise<unknown>[] = []

		if (leadId && status === 'sent') {
			updates.push(
				Lead.findByIdAndUpdate(leadId, {
					autoReplySent: true,
					autoReplySentAt: new Date(),
				}),
			)
			logger.info(`n8n callback: auto-reply marked sent for lead ${leadId}`)
		}

		if (workflowId) {
			updates.push(
				Workflow.findByIdAndUpdate(workflowId, {
					$inc: { triggerCount: 1 },
					lastTriggered: new Date(),
				}),
			)
		}

		await Promise.all(updates)

		if (error) {
			logger.warn(
				`n8n callback error (lead=${leadId}, event=${eventType}): ${error}`,
			)
		}

		res.json({ success: true })
	} catch (err) {
		next(err)
	}
}

// ─── WhatsApp Webhook Verification (GET) ─────────────────────────────────────
// Meta calls GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=X&hub.challenge=Y
// The platform registers one webhook URL for its own Meta App.  The verify token
// is a single platform-wide secret stored in WHATSAPP_WEBHOOK_VERIFY_TOKEN — no
// per-customer token look-up needed.

export const verifyWhatsAppWebhook = (
	req: Request,
	res: Response,
): void => {
	const mode = req.query['hub.mode'] as string
	const token = req.query['hub.verify_token'] as string
	const challenge = req.query['hub.challenge'] as string

	if (mode === 'subscribe' && token === config.whatsapp.webhookVerifyToken) {
		logger.info('WhatsApp webhook verified successfully')
		res.status(200).send(challenge)
		return
	}

	logger.warn('WhatsApp webhook verification failed — token mismatch')
	res.sendStatus(403)
}

// ─── WhatsApp Webhook (POST) ──────────────────────────────────────────────────
// The platform-owned Meta App signs every request with the platform APP_SECRET.
// We validate the HMAC once up-front, then route each payload to the right
// organisation by phoneNumberId.

export const handleWhatsAppWebhook = async (
	req: Request,
	res: Response,
): Promise<void> => {
	// Always ack immediately — Meta retries on non-200
	res.sendStatus(200)

	const rawBody: Buffer =
		(req as Request & { rawBody?: Buffer }).rawBody ??
		Buffer.from(JSON.stringify(req.body))
	const signature = (req.headers['x-hub-signature-256'] as string) ?? ''

	try {
		// Validate HMAC using platform-wide app secret before any DB work
		if (signature && config.whatsapp.appSecret) {
			const valid = verifyWebhookSignature(rawBody, signature, config.whatsapp.appSecret)
			if (!valid) {
				logger.error('WhatsApp webhook: HMAC signature validation failed')
				await WebhookLog.create({
					type: 'whatsapp_webhook',
					payload: req.body,
					status: 'failed',
					error: 'Signature validation failed',
				}).catch(() => {})
				return
			}
		}

		const payloads = parseWebhookPayload(req.body as Record<string, unknown>)

		for (const payload of payloads) {
			// Route to the right org / user via phoneNumberId
			const connection = await WhatsAppConnection.findOne({
				phoneNumberId: payload.phoneNumberId,
				isActive: true,
			})

			if (!connection) {
				logger.warn(
					`WhatsApp webhook for unknown phoneNumberId: ${payload.phoneNumberId}`,
				)
				continue
			}

			const userId = connection.userId.toString()
			const organizationId = connection.organizationId?.toString() ?? null

			const webhookLog = await WebhookLog.create({
				type: 'whatsapp_webhook',
				payload: req.body,
				status: 'processing',
				userId: connection.userId,
				processedAt: new Date(),
			})

			for (const message of payload.messages) {
				await addWhatsAppMessageJob({
					phoneNumberId: payload.phoneNumberId,
					wabaId: payload.wabaId,
					message,
					userId,
					organizationId,
				})
			}

			for (const status of payload.statuses) {
				await addWhatsAppStatusJob({ status, userId, organizationId })
			}

			await WebhookLog.findByIdAndUpdate(webhookLog._id, { status: 'processed' })
		}
	} catch (error) {
		logger.error('WhatsApp webhook handler error:', error)
		await WebhookLog.create({
			type: 'whatsapp_webhook',
			payload: req.body,
			status: 'failed',
			error: (error as Error).message,
		}).catch(() => {})
	}
}

export default {
	handleGmailWebhook,
	handleN8nWebhook,
	handleN8nCallback,
	getWebhookLogs,
	verifyWhatsAppWebhook,
	handleWhatsAppWebhook,
}
