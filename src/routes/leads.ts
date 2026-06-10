import type { Router } from 'express'
import { Router as createRouter } from 'express'
import {
	createLead,
	createLeadFromN8n,
	deleteLead,
	exportLeads,
	getLead,
	getLeads,
	getLeadStats,
	sendLeadEmail,
	testClassifyEmail,
	updateLead,
} from '../controllers/leadController'
import { verifyToken } from '../middlewares/auth'
import { n8nAuth } from '../middlewares/n8nAuth'
import { apiLimiter, webhookLimiter } from '../middlewares/rateLimiter'

const router: Router = createRouter()

// n8n lead-extraction workflow posts here with x-n8n-secret header
router.post('/', webhookLimiter, n8nAuth, createLeadFromN8n)

router.use(verifyToken)

router.post('/test-classify', apiLimiter, testClassifyEmail)
router.get('/', apiLimiter, getLeads)
router.post('/manual', apiLimiter, createLead) // Moved createLead route here to avoid conflict with n8n webhook route
router.get('/stats', apiLimiter, getLeadStats)
router.get('/export', exportLeads)
router.get('/:id', getLead)
router.post('/:id/send-email', apiLimiter, sendLeadEmail)
router.patch('/:id', updateLead)
router.delete('/:id', deleteLead)

export default router
