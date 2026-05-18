import { Router } from 'express'
import {
	createWorkflow,
	deleteWorkflow,
	getWorkflowExecutions,
	getWorkflows,
	getWorkflowTemplates,
	toggleWorkflow,
	updateWorkflow,
} from '../controllers/workflowController'
import { verifyToken } from '../middlewares/auth'

const router: Router = Router()

router.use(verifyToken)

router.get('/', getWorkflows)
router.post('/', createWorkflow)
router.get('/templates', getWorkflowTemplates)
router.patch('/:id', updateWorkflow)
router.delete('/:id', deleteWorkflow)
router.post('/:id/toggle', toggleWorkflow)
router.get('/:id/executions', getWorkflowExecutions)

export default router
