import { Router } from 'express';
import {
  connectGmail,
  handleGmailOAuthCallback,
  disconnectGmail,
  getGmailStatus,
  syncEmails,
  getEmailStats,
} from '../controllers/gmailController';
import { verifyToken } from '../middlewares/auth';
import { apiLimiter } from '../middlewares/rateLimiter';

const router = Router();

router.get('/connect', verifyToken, connectGmail);
router.post('/callback', verifyToken, handleGmailOAuthCallback);
router.post('/disconnect', verifyToken, disconnectGmail);
router.get('/status', verifyToken, getGmailStatus);
router.post('/sync', verifyToken, apiLimiter, syncEmails);
router.get('/email-stats', verifyToken, getEmailStats);

export default router;
