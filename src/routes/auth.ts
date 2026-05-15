import { Router } from 'express';
import {
  googleLogin,
  googleCallback,
  refreshToken,
  logout,
  getProfile,
  updateProfile,
} from '../controllers/authController';
import { verifyToken } from '../middlewares/auth';
import { authLimiter } from '../middlewares/rateLimiter';

const router = Router();

router.get('/google', authLimiter, googleLogin);
router.get('/google/callback', googleCallback);
router.post('/refresh', authLimiter, refreshToken);
router.post('/logout', verifyToken, logout);
router.get('/profile', verifyToken, getProfile);
router.patch('/profile', verifyToken, updateProfile);

export default router;
