import { Router } from 'express'
import { getNotifications, markAllAsRead, markAsRead } from '../controllers/notificationController'
import { verifyToken } from '../middlewares/auth'
import { apiLimiter } from '../middlewares/rateLimiter'

const router = Router()

router.use(verifyToken)

// read-all must come before /:id
router.patch('/read-all', apiLimiter, markAllAsRead)
router.get('/', apiLimiter, getNotifications)
router.patch('/:id/read', markAsRead)

export default router
