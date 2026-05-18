import type { Router } from 'express';
import { Router as createRouter } from 'express';
import {
  getLeads,
  getLead,
  updateLead,
  deleteLead,
  getLeadStats,
  exportLeads,
  createLeadFromN8n,
} from '../controllers/leadController';
import { verifyToken } from '../middlewares/auth';
import { n8nAuth } from '../middlewares/n8nAuth';
import { apiLimiter, webhookLimiter } from '../middlewares/rateLimiter';

const router: Router = createRouter();

// n8n lead-extraction workflow posts here with x-n8n-secret header
router.post('/', webhookLimiter, n8nAuth, createLeadFromN8n);

router.use(verifyToken);

router.get('/', apiLimiter, getLeads);
router.get('/stats', apiLimiter, getLeadStats);
router.get('/export', exportLeads);
router.get('/:id', getLead);
router.patch('/:id', updateLead);
router.delete('/:id', deleteLead);

export default router;
