import dotenv from 'dotenv'
dotenv.config()

import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { config } from './config'
import { connectDatabase } from './config/database'
import { errorHandler, notFoundHandler } from './middlewares/errorHandler'
import { globalLimiter } from './middlewares/rateLimiter'
import logger from './utils/logger'

// Routes
import authRoutes from './routes/auth'
import emailRoutes from './routes/email'
import gmailRoutes from './routes/gmail'
import leadRoutes from './routes/leads'
import settingsRoutes from './routes/settings'
import smtpRoutes from './routes/smtp'
import templateRoutes from './routes/templates'
import adminTemplateRoutes from './routes/adminTemplates'
import webhookRoutes from './routes/webhooks'
import workflowRoutes from './routes/workflows'
import notificationRoutes from './routes/notifications'

// Jobs
import { startGmailSyncJob } from './jobs/gmailSyncJob'
import { startGmailWatchRenewalJob } from './jobs/gmailWatchRenewalJob'

const app = express()

// Security middleware
app.use(
	helmet({
		crossOriginEmbedderPolicy: false,
		contentSecurityPolicy: false,
	}),
)

// CORS
app.use(
	cors({
		origin: (origin, callback) => {
			const allowedOrigins = [
				config.frontendUrl,
				'http://localhost:3000',
				'http://localhost:3001',
			]
			if (!origin || allowedOrigins.includes(origin)) {
				callback(null, true)
			} else {
				callback(new Error('Not allowed by CORS'))
			}
		},
		credentials: true,
		methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
	}),
)

// Body parsing
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Global rate limiter
app.use(globalLimiter)

// Health check
app.get('/health', (_req, res) => {
	res.json({
		status: 'ok',
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
		version: '1.0.0',
	})
})

// API Routes
app.use('/api/auth', authRoutes)
app.use('/api/email', emailRoutes)
app.use('/api/gmail', gmailRoutes)
app.use('/api/leads', leadRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/smtp', smtpRoutes)
app.use('/api/templates', templateRoutes)
app.use('/api/admin/templates', adminTemplateRoutes)
app.use('/api/workflows', workflowRoutes)
app.use('/api/webhooks', webhookRoutes)
app.use('/api/notifications', notificationRoutes)
app.post('/api/recieved', (req, res) => {
	logger.info('Received email data:', req.body)
	res.json({ success: true })
})

// 404 handler
app.use(notFoundHandler)

// Global error handler
app.use(errorHandler)

// Start server
const startServer = async (): Promise<void> => {
	try {
		// Connect to database
		await connectDatabase()

		// Start HTTP server
		const server = app.listen(config.port, () => {
			logger.info(
				`Server running on port ${config.port} in ${config.nodeEnv} mode`,
			)
			logger.info(`Health check: http://localhost:${config.port}/health`)
		})

		// Start cron jobs
		startGmailSyncJob()
		startGmailWatchRenewalJob()

		// Graceful shutdown
		const shutdown = async (signal: string) => {
			logger.info(`Received ${signal}, shutting down gracefully...`)
			server.close(async () => {
				const { disconnectDatabase } = await import('./config/database')
				await disconnectDatabase()
				logger.info('Server closed')
				process.exit(0)
			})

			// Force exit after 30 seconds
			setTimeout(() => {
				logger.error('Forced shutdown after timeout')
				process.exit(1)
			}, 30000)
		}

		process.on('SIGTERM', () => shutdown('SIGTERM'))
		process.on('SIGINT', () => shutdown('SIGINT'))
	} catch (error) {
		logger.error('Failed to start server:', error)
		process.exit(1)
	}
}

startServer()

export default app
