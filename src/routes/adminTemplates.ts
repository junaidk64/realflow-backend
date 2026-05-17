import { Router } from 'express'
import {
  adminListTemplates,
  approveTemplate,
  rejectTemplate,
} from '../controllers/adminTemplateController'
import { verifyToken, requireRole } from '../middlewares/auth'
import { apiLimiter } from '../middlewares/rateLimiter'

const router = Router()

router.use(verifyToken)
router.use(requireRole(['admin']))

router.get('/', apiLimiter, adminListTemplates)
router.patch('/:id/approve', approveTemplate)
router.patch('/:id/reject', rejectTemplate)

export default router
