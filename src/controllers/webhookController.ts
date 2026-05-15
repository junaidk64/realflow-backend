import { NextFunction, Request, Response } from 'express'
import { GmailConnection } from '../models/GmailConnection'
import { Lead } from '../models/Lead'
import { WebhookLog } from '../models/WebhookLog'
import { addEmailProcessingJob } from '../services/queueService'
import logger from '../utils/logger'

export const handleGmailWebhook = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const body = req.body

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

						logger.info(`Gmail webhook processed for ${emailAddress}`)
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

export default { handleGmailWebhook, handleN8nWebhook, getWebhookLogs }
