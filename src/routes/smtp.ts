import { Router } from 'express'
import {
	connectSmtp,
	disconnectSmtp,
	getSmtpStatus,
	testSmtp,
} from '../controllers/smtpController'
import { verifyToken } from '../middlewares/auth'
import { apiLimiter } from '../middlewares/rateLimiter'

const router: Router = Router()

router.use(verifyToken)

router.post('/connect', apiLimiter, connectSmtp)
router.delete('/disconnect', disconnectSmtp)
router.get('/status', getSmtpStatus)
router.post('/test', apiLimiter, testSmtp)

export default router
