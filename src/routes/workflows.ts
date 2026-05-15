import { Router } from 'express';
import {
  getWorkflows,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  toggleWorkflow,
  getWorkflowTemplates,
  getWorkflowExecutions,
} from '../controllers/workflowController';
import { verifyToken } from '../middlewares/auth';

const router = Router();

router.use(verifyToken);

router.get('/', getWorkflows);
router.post('/', createWorkflow);
router.get('/templates', getWorkflowTemplates);
router.patch('/:id', updateWorkflow);
router.delete('/:id', deleteWorkflow);
router.post('/:id/toggle', toggleWorkflow);
router.get('/:id/executions', getWorkflowExecutions);

export default router;
