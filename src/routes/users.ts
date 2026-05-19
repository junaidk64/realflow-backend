import { Router } from 'express'
import {
	acceptInvite,
	inviteMember,
	listInvitations,
	listMembers,
	removeMember,
	revokeInvitation,
	updateMember,
	verifyInvitation,
} from '../controllers/usersController'
import { verifyToken } from '../middlewares/auth'
import requirePermission from '../middlewares/requirePermission'

const router: Router = Router()

// Public
router.get('/invitations/verify', verifyInvitation)
router.post('/accept-invite', acceptInvite)

// Protected — require users:* permissions
router.get('/', verifyToken, requirePermission('users:view'), listMembers)
router.post('/invite', verifyToken, requirePermission('users:invite'), inviteMember)
router.get('/invitations', verifyToken, requirePermission('users:view'), listInvitations)
router.delete('/invitations/:id', verifyToken, requirePermission('users:edit'), revokeInvitation)
router.patch('/:id', verifyToken, requirePermission('users:edit'), updateMember)
router.delete('/:id', verifyToken, requirePermission('users:delete'), removeMember)

export default router
