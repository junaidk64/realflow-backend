import { Router } from 'express'
import {
	draftReply,
	getEmailProviderStatus,
	sendEmail,
} from '../controllers/emailController'
import { verifyToken } from '../middlewares/auth'
import { n8nAuth } from '../middlewares/n8nAuth'
import { apiLimiter, webhookLimiter } from '../middlewares/rateLimiter'

const router: Router = Router()

// n8n calls this instead of using its own Gmail node
// x-n8n-secret header required
router.post('/send', webhookLimiter, n8nAuth, sendEmail)

// Dashboard: show which email provider is active for the logged-in user
router.get('/provider-status', verifyToken, apiLimiter, getEmailProviderStatus)

// AI reply drafting: Gemini classifies/summarizes (free), Claude Haiku drafts (~$0.001/email)
router.post('/draft-reply', verifyToken, apiLimiter, draftReply)

export default router
