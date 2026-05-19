import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { NextFunction, Request, Response } from 'express'
import nodemailer from 'nodemailer'
import { Resend } from 'resend'
import { config } from '../config'
import { getRoleLevel } from '../middlewares/requirePermission'
import { Invitation } from '../models/Invitation'
import { Organization } from '../models/Organization'
import { User } from '../models/User'
import { generateTokenPair } from '../services/authService'
import logger from '../utils/logger'

const resend = new Resend(config.resend.apiKey)

// GET /api/users
export const listMembers = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const members = await User.find({
			organizationId: req.user!.organizationId,
			isActive: true,
		}).select(
			'-__v -password -googleId -stripeCustomerId -stripeSubscriptionId',
		)

		res.json({ success: true, data: { members } })
	} catch (error) {
		next(error)
	}
}

// POST /api/users/invite
export const inviteMember = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { email, role, permissions = [] } = req.body
		const orgId = req.user!.organizationId

		if (!email || !role) {
			res
				.status(400)
				.json({ success: false, message: 'email and role are required' })
			return
		}

		const allowedRoles = ['admin', 'manager', 'member']
		if (!allowedRoles.includes(role)) {
			res.status(400).json({ success: false, message: 'Invalid role' })
			return
		}

		// Cannot invite with a role >= actor's role
		const actorLevel = getRoleLevel(req.user!.role)
		const targetLevel = getRoleLevel(role)
		if (targetLevel >= actorLevel) {
			res.status(403).json({
				success: false,
				message: 'Cannot invite a member with equal or higher role than yours',
			})
			return
		}

		const existingUser = await User.findOne({
			email: email.toLowerCase(),
			organizationId: orgId,
		})
		if (existingUser) {
			res.status(409).json({
				success: false,
				message: 'User is already a member of this organization',
			})
			return
		}

		const existingInvitation = await Invitation.findOne({
			email: email.toLowerCase(),
			organizationId: orgId,
			status: 'pending',
		})
		if (existingInvitation) {
			res.status(409).json({
				success: false,
				message: 'A pending invitation already exists for this email',
			})
			return
		}

		const org = await Organization.findById(orgId)
		const businessName = org?.name ?? 'LeadFlow Pro'

		const token = crypto.randomUUID()
		const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

		const invitation = await Invitation.create({
			email: email.toLowerCase(),
			role,
			permissions,
			organizationId: orgId,
			invitedBy: req.user!.userId,
			token,
			expiresAt,
		})

		const inviteLink = `${config.frontendUrl}/accept-invite?token=${token}`

		try {
			await nodemailer
				.createTransport({
					host: config.smtp.host,
					port: config.smtp.port,
					secure: false, // true for 465, false for other ports
					auth: {
						user: config.smtp.user,
						pass: config.smtp.pass,
					},
				})
				.sendMail({
					from: `LeadFlow Pro <noreply@${config.smtp.host || 'mail.leadflowpro.com'}>`,
					to: email,
					subject: `You've been invited to join ${businessName} on LeadFlow Pro`,
					html: `
					<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
						<h2>You're invited!</h2>
						<p>You've been invited to join <strong>${businessName}</strong> on LeadFlow Pro as a <strong>${role}</strong>.</p>
						<p>Click the button below to accept your invitation. This link expires in 7 days.</p>
						<a href="${inviteLink}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin:16px 0">
							Accept Invitation
						</a>
						<p style="color:#6b7280;font-size:14px">Or copy this link: ${inviteLink}</p>
					</div>
				`,
				})
		} catch (emailErr) {
			logger.warn('Failed to send invitation email:', emailErr)
		}

		res.json({ success: true, data: { invitation } })
	} catch (error) {
		next(error)
	}
}

// PATCH /api/users/:id
export const updateMember = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { id } = req.params
		const { role, permissions, isActive } = req.body
		const actorLevel = getRoleLevel(req.user!.role)

		const target = await User.findOne({
			_id: id,
			organizationId: req.user!.organizationId,
		})
		if (!target) {
			res.status(404).json({
				success: false,
				message: 'User not found in your organization',
			})
			return
		}

		if (target.role === 'root') {
			res
				.status(403)
				.json({ success: false, message: 'Cannot modify the root user' })
			return
		}

		if (role !== undefined) {
			const newLevel = getRoleLevel(role)
			if (newLevel >= actorLevel) {
				res.status(403).json({
					success: false,
					message: 'Cannot set a role equal to or higher than your own',
				})
				return
			}
			target.role = role
		}

		if (permissions !== undefined) {
			target.permissions = permissions
		}

		if (isActive !== undefined) {
			target.isActive = isActive
		}

		await target.save()

		const updated = target.toJSON()
		res.json({ success: true, data: { user: updated } })
	} catch (error) {
		next(error)
	}
}

// DELETE /api/users/:id
export const removeMember = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { id } = req.params

		if (id === req.user!.userId) {
			res
				.status(403)
				.json({ success: false, message: 'Cannot remove yourself' })
			return
		}

		const target = await User.findOne({
			_id: id,
			organizationId: req.user!.organizationId,
		})
		if (!target) {
			res.status(404).json({
				success: false,
				message: 'User not found in your organization',
			})
			return
		}

		if (target.role === 'root') {
			res
				.status(403)
				.json({ success: false, message: 'Cannot remove the root user' })
			return
		}

		// Soft-delete: deactivate and unlink from org
		target.isActive = false
		target.organizationId = null
		await target.save()

		res.json({ success: true, message: 'Member removed from organization' })
	} catch (error) {
		next(error)
	}
}

// GET /api/users/invitations
export const listInvitations = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const invitations = await Invitation.find({
			organizationId: req.user!.organizationId,
		})
			.populate('invitedBy', 'name email')
			.sort({ createdAt: -1 })

		res.json({ success: true, data: { invitations } })
	} catch (error) {
		next(error)
	}
}

// DELETE /api/users/invitations/:id
export const revokeInvitation = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { id } = req.params

		const invitation = await Invitation.findOne({
			_id: id,
			organizationId: req.user!.organizationId,
			status: 'pending',
		})

		if (!invitation) {
			res
				.status(404)
				.json({ success: false, message: 'Pending invitation not found' })
			return
		}

		invitation.status = 'revoked'
		await invitation.save()

		res.json({ success: true, message: 'Invitation revoked' })
	} catch (error) {
		next(error)
	}
}

// GET /api/users/invitations/verify?token= (public)
export const verifyInvitation = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { token } = req.query as { token?: string }

		if (!token) {
			res.status(400).json({ success: false, message: 'token is required' })
			return
		}

		const invitation = await Invitation.findOne({ token })
			.populate<{ invitedBy: { name: string } }>('invitedBy', 'name')
			.lean()

		if (!invitation) {
			res.status(404).json({ success: false, message: 'Invitation not found' })
			return
		}

		if (invitation.status !== 'pending' || invitation.expiresAt < new Date()) {
			res.status(410).json({
				success: false,
				message: 'This invitation has expired or already been used.',
			})
			return
		}

		const org = await Organization.findById(invitation.organizationId).lean()

		res.json({
			success: true,
			data: {
				email: invitation.email,
				role: invitation.role,
				organizationName: org?.name ?? 'Unknown Organization',
				inviterName: (invitation.invitedBy as { name: string } | null)?.name ?? 'A team member',
			},
		})
	} catch (error) {
		next(error)
	}
}

// POST /api/users/accept-invite (public)
export const acceptInvite = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { token, name, password } = req.body

		if (!token) {
			res.status(400).json({ success: false, message: 'token is required' })
			return
		}

		const invitation = await Invitation.findOne({ token })
		if (!invitation) {
			res
				.status(404)
				.json({ success: false, message: 'Invalid invitation token' })
			return
		}

		if (invitation.status !== 'pending') {
			res
				.status(400)
				.json({ success: false, message: `Invitation is ${invitation.status}` })
			return
		}

		if (invitation.expiresAt < new Date()) {
			invitation.status = 'expired'
			await invitation.save()
			res
				.status(400)
				.json({ success: false, message: 'Invitation has expired' })
			return
		}

		let user = await User.findOne({ email: invitation.email })

		if (user) {
			// Existing user — link to organization
			user.organizationId = invitation.organizationId
			user.role = invitation.role as any
			user.permissions = invitation.permissions
			user.invitedBy = invitation.invitedBy
			await user.save()
		} else {
			// New user
			if (!name) {
				res
					.status(400)
					.json({ success: false, message: 'name is required for new users' })
				return
			}

			const hashedPassword = password
				? await bcrypt.hash(password, 10)
				: undefined

			user = await User.create({
				email: invitation.email,
				name,
				password: hashedPassword,
				googleId: null,
				role: invitation.role,
				permissions: invitation.permissions,
				organizationId: invitation.organizationId,
				invitedBy: invitation.invitedBy,
			})
		}

		invitation.status = 'accepted'
		await invitation.save()

		const tokens = generateTokenPair(user)

		res.json({
			success: true,
			data: {
				accessToken: tokens.accessToken,
				refreshToken: tokens.refreshToken,
				user: {
					_id: user._id,
					name: user.name,
					email: user.email,
					role: user.role,
					permissions: user.permissions,
					organizationId: user.organizationId,
				},
			},
		})
	} catch (error) {
		next(error)
	}
}

export default {
	listMembers,
	inviteMember,
	updateMember,
	removeMember,
	listInvitations,
	revokeInvitation,
	verifyInvitation,
	acceptInvite,
}
