import { Router } from 'express'
import {
	createTemplate,
	deleteTemplate,
	getPublicTemplates,
	getSystemTemplates,
	getTemplate,
	getTemplates,
	publishTemplate,
	renderTemplate,
	updateTemplate,
} from '../controllers/templateController'
import { verifyToken } from '../middlewares/auth'
import { apiLimiter } from '../middlewares/rateLimiter'

const router: Router = Router()

router.use(verifyToken)

// Must be before /:id to prevent "public" or "system" being treated as an ID
router.get('/public', apiLimiter, getPublicTemplates)
router.get('/system', apiLimiter, getSystemTemplates)

router.get('/', apiLimiter, getTemplates)
router.post('/', createTemplate)
router.post('/:id/render', renderTemplate)
router.get('/:id', getTemplate)
router.patch('/:id', updateTemplate)
router.delete('/:id', deleteTemplate)
router.patch('/:id/publish', publishTemplate)

export default router
