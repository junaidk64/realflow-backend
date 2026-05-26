import { Router } from 'express'
import {
	assignTemplate,
	createWorkflow,
	deleteWorkflow,
	getCatalogue,
	getWorkflowExecutions,
	getWorkflows,
	getWorkflowTemplates,
	installWorkflow,
	installWorkflowTemplate,
	toggleWorkflow,
	updateWorkflow,
} from '../controllers/workflowController'
import { verifyToken } from '../middlewares/auth'

const router: Router = Router()

router.use(verifyToken)

// Catalogue — available workflow types with installed status
router.get('/catalogue', getCatalogue)

// Install a backend-managed workflow type
router.post('/install/:type', installWorkflow)

// Installed workflows list
router.get('/', getWorkflows)

// Custom / n8n workflow creation
router.post('/', createWorkflow)

// Per-workflow operations
router.patch('/:id', updateWorkflow)
router.delete('/:id', deleteWorkflow)
router.post('/:id/toggle', toggleWorkflow)
router.get('/templates', getWorkflowTemplates)
router.post('/install-template/:templateId', installWorkflowTemplate)
router.patch('/:id/template', assignTemplate)
router.get('/:id/executions', getWorkflowExecutions)

export default router
