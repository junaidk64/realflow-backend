import { Router } from 'express'
import {
	getWebhookLogs,
	handleGmailWebhook,
	handleN8nCallback,
	handleN8nWebhook,
	verifyWhatsAppWebhook,
	handleWhatsAppWebhook,
} from '../controllers/webhookController'
import { verifyToken } from '../middlewares/auth'
import { n8nAuth } from '../middlewares/n8nAuth'
import { webhookLimiter } from '../middlewares/rateLimiter'

const router: Router = Router()

// Gmail push notifications (verified by Google pubsub token)
router.post('/gmail', webhookLimiter, handleGmailWebhook)

// n8n callbacks — secured by x-n8n-secret header
router.post('/n8n', webhookLimiter, n8nAuth, handleN8nWebhook)
router.post('/n8n-callback', webhookLimiter, n8nAuth, handleN8nCallback)

// WhatsApp Cloud API — GET for Meta verification challenge, POST for events
// rawBody middleware must run before express.json() for signature validation
router.get('/whatsapp', verifyWhatsAppWebhook)
router.post('/whatsapp', webhookLimiter, handleWhatsAppWebhook)

// Protected log endpoint
router.get('/logs', verifyToken, getWebhookLogs)

export default router
