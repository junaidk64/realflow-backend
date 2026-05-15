import { Router } from 'express';
import {
  getLeads,
  getLead,
  updateLead,
  deleteLead,
  getLeadStats,
  exportLeads,
} from '../controllers/leadController';
import { verifyToken } from '../middlewares/auth';
import { apiLimiter } from '../middlewares/rateLimiter';

const router = Router();

router.use(verifyToken);

router.get('/', apiLimiter, getLeads);
router.get('/stats', apiLimiter, getLeadStats);
router.get('/export', exportLeads);
router.get('/:id', getLead);
router.patch('/:id', updateLead);
router.delete('/:id', deleteLead);

export default router;
