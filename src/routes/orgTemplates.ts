import { Router } from 'express'
import {
  cloneSystemTemplate,
  createOrgTemplate,
  deleteOrgTemplate,
  getOrgTemplate,
  getOrgTemplates,
  getSystemTemplates,
  resetOrgTemplate,
  updateOrgTemplate,
} from '../controllers/orgTemplateController'
import { verifyToken } from '../middlewares/auth'
import { apiLimiter } from '../middlewares/rateLimiter'

const router: Router = Router()

router.use(verifyToken)

// System template browsing (read-only for all authed users)
router.get('/system', apiLimiter, getSystemTemplates)

// Org-specific editable template copies
router.get('/', apiLimiter, getOrgTemplates)
router.post('/', createOrgTemplate)
router.post('/clone/:systemTemplateId', cloneSystemTemplate)
router.get('/:id', getOrgTemplate)
router.patch('/:id', updateOrgTemplate)
router.delete('/:id', deleteOrgTemplate)
router.post('/:id/reset', resetOrgTemplate)

export default router
