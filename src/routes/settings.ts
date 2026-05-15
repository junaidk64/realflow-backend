import { Router } from 'express';
import {
  getSettings,
  updateSettings,
  testEmailTemplate,
  updateEmailSignature,
} from '../controllers/settingsController';
import { verifyToken } from '../middlewares/auth';

const router = Router();

router.use(verifyToken);

router.get('/', getSettings);
router.patch('/', updateSettings);
router.post('/test-template', testEmailTemplate);
router.patch('/signature', updateEmailSignature);

export default router;
