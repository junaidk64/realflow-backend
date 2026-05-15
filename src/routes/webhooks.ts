import { Router } from 'express';
import {
  handleGmailWebhook,
  handleN8nWebhook,
  getWebhookLogs,
} from '../controllers/webhookController';
import { verifyToken } from '../middlewares/auth';
import { webhookLimiter } from '../middlewares/rateLimiter';

const router = Router();

// Public webhook endpoints (secured by payload verification)
router.post('/gmail', webhookLimiter, handleGmailWebhook);
router.post('/n8n', webhookLimiter, handleN8nWebhook);

// Protected log endpoint
router.get('/logs', verifyToken, getWebhookLogs);

export default router;
