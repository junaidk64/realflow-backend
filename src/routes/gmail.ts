import { Router } from 'express'
import {
	connectGmail,
	disconnectGmail,
	getEmailStats,
	getGmailStatus,
	handleGmailOAuthCallback,
	renewGmailWatch,
	syncEmails,
} from '../controllers/gmailController'
import { verifyToken } from '../middlewares/auth'
import { apiLimiter } from '../middlewares/rateLimiter'

const router: Router = Router()

router.get('/connect', verifyToken, connectGmail)
router.post('/callback', verifyToken, handleGmailOAuthCallback)
router.post('/disconnect', verifyToken, disconnectGmail)
router.get('/status', verifyToken, getGmailStatus)
router.post('/sync', verifyToken, apiLimiter, syncEmails)
router.get('/email-stats', verifyToken, getEmailStats)
// Called by n8n workflow 6 (cron every 6 days) with BACKEND_SERVICE_TOKEN
router.post('/renew-watch', verifyToken, renewGmailWatch)

export default router
