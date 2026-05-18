import { Router } from 'express'
import {
	getProfile,
	googleCallback,
	googleLogin,
	logout,
	refreshToken,
	updateProfile,
} from '../controllers/authController'
import { verifyToken } from '../middlewares/auth'
import { authLimiter } from '../middlewares/rateLimiter'

const router: Router = Router()

router.get('/google', authLimiter, googleLogin)
router.get('/google/callback', googleCallback)
router.post('/refresh', authLimiter, refreshToken)
router.post('/logout', verifyToken, logout)
router.get('/profile', verifyToken, getProfile)
router.patch('/profile', verifyToken, updateProfile)

export default router
