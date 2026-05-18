import { Request, Response, NextFunction } from 'express'
import { Notification } from '../models/Notification'

export const getNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
	try {
		const limit = Math.min(parseInt(req.query.limit as string) || 20, 100)
		const notifications = await Notification.find({ userId: req.user!.userId })
			.sort({ createdAt: -1 })
			.limit(limit)
			.lean()

		res.json({ success: true, data: notifications })
	} catch (error) {
		next(error)
	}
}

export const markAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
	try {
		await Notification.findOneAndUpdate(
			{ _id: req.params.id, userId: req.user!.userId },
			{ read: true },
		)
		res.json({ success: true })
	} catch (error) {
		next(error)
	}
}

export const markAllAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
	try {
		await Notification.updateMany({ userId: req.user!.userId, read: false }, { read: true })
		res.json({ success: true })
	} catch (error) {
		next(error)
	}
}
