import { NextFunction, Request, Response } from 'express'
import { OAuth2Client } from 'google-auth-library'
import { config } from '../config'
import { EmailLog } from '../models/EmailLog'
import { GmailConnection } from '../models/GmailConnection'
import { Lead } from '../models/Lead'
import { WebhookLog } from '../models/WebhookLog'
import { generateAuthUrl } from '../services/authService'
import { saveGmailConnection, setupGmailWatch } from '../services/gmailService'
import { addEmailProcessingJob } from '../services/queueService'
import logger from '../utils/logger'

export const connectGmail = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const authUrl = generateAuthUrl()
		res.json({ success: true, data: { url: authUrl } })
	} catch (error) {
		next(error)
	}
}

export const handleGmailOAuthCallback = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { code } = req.body
		if (!code) {
			res
				.status(400)
				.json({ success: false, message: 'Authorization code required' })
			return
		}

		const oauth2Client = new OAuth2Client(
			config.google.clientId,
			config.google.clientSecret,
			config.google.redirectUri,
		)

		const { tokens } = await oauth2Client.getToken(code)

		if (!tokens.access_token || !tokens.refresh_token) {
			res
				.status(400)
				.json({ success: false, message: 'Failed to get Gmail tokens' })
			return
		}

		// Get user email
		oauth2Client.setCredentials(tokens)
		const oauth2 = new (require('googleapis').google.auth.OAuth2)(
			config.google.clientId,
			config.google.clientSecret,
		)
		oauth2.setCredentials(tokens)

		const gmail = require('googleapis').google.gmail({
			version: 'v1',
			auth: oauth2Client,
		})
		const profile = await gmail.users.getProfile({ userId: 'me' })
		const email = profile.data.emailAddress

		const gmailConnection = await saveGmailConnection(
			req.user!.userId,
			email,
			tokens.access_token,
			tokens.refresh_token,
			new Date(tokens.expiry_date || Date.now() + 3600000),
		)

		// Setup Gmail watch
		try {
			await setupGmailWatch(gmailConnection)
		} catch (watchError) {
			logger.warn(
				'Gmail watch setup failed (pub/sub not configured):',
				watchError,
			)
		}

		res.json({
			success: true,
			data: {
				email,
				isActive: true,
				message: 'Gmail connected successfully',
			},
		})
	} catch (error) {
		next(error)
	}
}

export const disconnectGmail = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		await GmailConnection.findOneAndUpdate(
			{ userId: req.user!.userId },
			{ isActive: false },
		)
		res.json({ success: true, message: 'Gmail disconnected' })
	} catch (error) {
		next(error)
	}
}

async function fetchEmailStatsForConnection(
	connection: InstanceType<typeof GmailConnection>,
): Promise<{ unread: number; total: number }> {
	const userId = connection.userId.toString()
	const [total, unread] = await Promise.all([
		EmailLog.countDocuments({ userId }),
		EmailLog.countDocuments({ userId, status: 'unread' }),
	])
	return { unread, total }
}

export const getGmailStatus = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const connection = await GmailConnection.findOne({
			userId: req.user!.userId,
		})

		if (!connection) {
			res.json({ success: true, data: { connected: false } })
			return
		}

		let stats = { unread: 0, total: 0 }
		if (connection.isActive) {
			try {
				stats = await fetchEmailStatsForConnection(connection)
			} catch {
				// Non-critical
			}
		}

		const recentEmails = await EmailLog.find({ userId: req.user!.userId })
			.sort({ createdAt: -1 })
			.limit(5)
			.select('from subject status createdAt type')

		res.json({
			success: true,
			data: {
				connected: connection.isActive,
				email: connection.email,
				lastSyncAt: connection.lastSyncAt,
				watchExpiry: connection.watchExpiry,
				syncError: connection.syncError,
				stats,
				recentEmails,
			},
		})
	} catch (error) {
		next(error)
	}
}

export const syncEmails = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const connection = await GmailConnection.findOne({
			userId: req.user!.userId,
			isActive: true,
		})

		if (!connection) {
			res
				.status(400)
				.json({ success: false, message: 'No active Gmail connection' })
			return
		}

		const job = await addEmailProcessingJob(
			req.user!.userId,
			connection._id.toString(),
		)

		res.json({
			success: true,
			data: { jobId: job.id, message: 'Email sync started' },
		})
	} catch (error) {
		next(error)
	}
}

export const getEmailStats = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const userId = req.user!.userId
		const now = new Date()
		const startOfDay = new Date(now.setHours(0, 0, 0, 0))

		const [totalEmails, todayEmails, totalLeads, todayLeads] =
			await Promise.all([
				EmailLog.countDocuments({ userId }),
				EmailLog.countDocuments({ userId, createdAt: { $gte: startOfDay } }),
				Lead.countDocuments({ userId }),
				Lead.countDocuments({ userId, createdAt: { $gte: startOfDay } }),
			])

		res.json({
			success: true,
			data: { totalEmails, todayEmails, totalLeads, todayLeads },
		})
	} catch (error) {
		next(error)
	}
}

export const processWebhook = async (
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

		// Decode Pub/Sub message
		if (body.message?.data) {
			const decoded = JSON.parse(
				Buffer.from(body.message.data, 'base64').toString(),
			)
			const { emailAddress, historyId } = decoded

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
			}
		}

		res.status(200).json({ success: true })
	} catch (error) {
		next(error)
	}
}

export const renewGmailWatch = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const userId = req.user!.userId

		const connection = await GmailConnection.findOne({ userId, isActive: true })
		if (!connection) {
			res.status(404).json({ success: false, message: 'No active Gmail connection found' })
			return
		}

		await setupGmailWatch(connection)
		logger.info(`Gmail watch renewed for user ${userId}`)

		res.json({
			success: true,
			data: { email: connection.email, watchExpiry: connection.watchExpiry },
		})
	} catch (error) {
		logger.error('Gmail watch renewal failed:', error)
		next(error)
	}
}

export default {
	connectGmail,
	handleGmailOAuthCallback,
	disconnectGmail,
	getGmailStatus,
	syncEmails,
	getEmailStats,
	processWebhook,
	renewGmailWatch,
}
