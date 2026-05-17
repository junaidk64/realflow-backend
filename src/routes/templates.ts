import { Router } from 'express'
import {
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  publishTemplate,
  getPublicTemplates,
  renderTemplate,
} from '../controllers/templateController'
import { verifyToken } from '../middlewares/auth'
import { apiLimiter } from '../middlewares/rateLimiter'

const router = Router()

router.use(verifyToken)

// Must be before /:id to prevent "public" being treated as an ID
router.get('/public', apiLimiter, getPublicTemplates)

router.get('/', apiLimiter, getTemplates)
router.post('/', createTemplate)
router.post('/:id/render', renderTemplate)
router.get('/:id', getTemplate)
router.patch('/:id', updateTemplate)
router.delete('/:id', deleteTemplate)
router.patch('/:id/publish', publishTemplate)

export default router
