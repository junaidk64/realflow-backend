import { Router } from 'express'
import {
	getEmbeddedSignupConfig,
	completeEmbeddedSignup,
	disconnectWhatsApp,
	getWhatsAppStatus,
	sendWhatsAppMessage,
	getWhatsAppConversations,
	getLeadMessages,
} from '../controllers/whatsappController'
import { verifyToken } from '../middlewares/auth'
import { apiLimiter } from '../middlewares/rateLimiter'

const router: Router = Router()

// All routes require authentication
router.use(verifyToken)

// Embedded Signup — replaces the old manual /connect endpoint
router.get('/embedded-signup/config', getEmbeddedSignupConfig)
router.post('/embedded-signup/complete', completeEmbeddedSignup)

// Connection management
router.delete('/disconnect', disconnectWhatsApp)
router.get('/status', getWhatsAppStatus)

// Messaging
router.post('/send', apiLimiter, sendWhatsAppMessage)

// Inbox
router.get('/conversations', getWhatsAppConversations)
router.get('/conversations/:leadId/messages', getLeadMessages)

export default router
