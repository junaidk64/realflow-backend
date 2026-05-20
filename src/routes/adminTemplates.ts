import { Router } from 'express'
import {
  adminListTemplates,
  approveTemplate,
  rejectTemplate,
  listSystemTemplates,
  createSystemTemplate,
  updateSystemTemplate,
  deleteSystemTemplate,
} from '../controllers/adminTemplateController'
import { requireRole, verifyToken } from '../middlewares/auth'
import { apiLimiter } from '../middlewares/rateLimiter'

const router: Router = Router()

router.use(verifyToken)
router.use(requireRole(['admin']))

// System template management
router.get('/system', apiLimiter, listSystemTemplates)
router.post('/system', createSystemTemplate)
router.patch('/system/:id', updateSystemTemplate)
router.delete('/system/:id', deleteSystemTemplate)

// User-submitted template moderation
router.get('/', apiLimiter, adminListTemplates)
router.patch('/:id/approve', approveTemplate)
router.patch('/:id/reject', rejectTemplate)

export default router
