import { NextFunction, Request, Response } from 'express'
import { config } from '../config'
import { GmailConnection } from '../models/GmailConnection'
import { User } from '../models/User'
import {
	generateAuthUrl,
	handleCallback,
	refreshAccessToken,
} from '../services/authService'
import { saveGmailConnection, setupGmailWatch } from '../services/gmailService'
import logger from '../utils/logger'

export const googleLogin = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const state = Buffer.from(
			JSON.stringify({ redirect: req.query.redirect || '/dashboard' }),
		).toString('base64')
		const authUrl = generateAuthUrl(state)
		res.json({ success: true, data: { url: authUrl } })
	} catch (error) {
		next(error)
	}
}

export const googleCallback = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { code, error: oauthError } = req.query

		if (oauthError) {
			res.redirect(`${config.frontendUrl}/login?error=${oauthError}`)
			return
		}

		if (!code || typeof code !== 'string') {
			res.redirect(`${config.frontendUrl}/login?error=missing_code`)
			return
		}

		const { user, tokens, googleTokens, isNewUser } = await handleCallback(code)

		// Save Gmail connection using tokens already obtained in handleCallback.
		// The auth code is single-use — never call getToken(code) again here.
		if (googleTokens.accessToken && googleTokens.refreshToken) {
			try {
				const gmailConnection = await saveGmailConnection(
					user._id.toString(),
					user.email,
					googleTokens.accessToken,
					googleTokens.refreshToken,
					new Date(googleTokens.expiryDate),
				)
				// Attempt to start Pub/Sub watch (non-fatal if Pub/Sub not configured)
				setupGmailWatch(gmailConnection).catch(watchErr =>
					logger.warn('Gmail watch setup skipped (Pub/Sub not configured):', watchErr)
				)
			} catch (gmailErr) {
				logger.warn('Failed to save Gmail connection during OAuth:', gmailErr)
			}
		}

		const redirectUrl = `${config.frontendUrl}/callback?accessToken=${tokens.accessToken}&refreshToken=${tokens.refreshToken}&isNew=${isNewUser}`
		res.redirect(redirectUrl)
	} catch (error) {
		logger.error('Google callback error:', error)
		res.redirect(`${config.frontendUrl}/login?error=auth_failed`)
	}
}

export const refreshToken = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { refreshToken: token } = req.body
		if (!token) {
			res
				.status(400)
				.json({ success: false, message: 'Refresh token required' })
			return
		}

		const tokens = await refreshAccessToken(token)
		res.json({ success: true, data: tokens })
	} catch (error) {
		if ((error as Error).message.includes('expired')) {
			res
				.status(401)
				.json({
					success: false,
					message: 'Refresh token expired',
					code: 'REFRESH_TOKEN_EXPIRED',
				})
			return
		}
		next(error)
	}
}

export const logout = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		res.json({ success: true, message: 'Logged out successfully' })
	} catch (error) {
		next(error)
	}
}

export const getProfile = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const user = await User.findById(req.user!.userId).select('-__v')
		if (!user) {
			res.status(404).json({ success: false, message: 'User not found' })
			return
		}

		const gmailConnection = await GmailConnection.findOne({
			userId: req.user!.userId,
		}).select('email isActive lastSyncAt watchExpiry')

		res.json({
			success: true,
			data: {
				user,
				gmailConnected: !!gmailConnection?.isActive,
				gmailEmail: gmailConnection?.email,
			},
		})
	} catch (error) {
		next(error)
	}
}

export const updateProfile = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { name, avatar } = req.body
		const updateData: Record<string, string> = {}
		if (name) updateData.name = name
		if (avatar) updateData.avatar = avatar

		const user = await User.findByIdAndUpdate(req.user!.userId, updateData, {
			new: true,
			select: '-__v',
		})

		res.json({ success: true, data: { user } })
	} catch (error) {
		next(error)
	}
}

export default {
	googleLogin,
	googleCallback,
	refreshToken,
	logout,
	getProfile,
	updateProfile,
}
