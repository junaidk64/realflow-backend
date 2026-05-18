import { Settings } from '../models/Settings'
import { Notification, NotificationType } from '../models/Notification'
import logger from '../utils/logger'

function typeToPref(type: NotificationType): keyof NonNullable<{ newLead: boolean; autoReplySent: boolean; workflowTriggered: boolean; dailySummary: boolean }> {
	const map: Record<NotificationType, string> = {
		new_lead: 'newLead',
		auto_reply_sent: 'autoReplySent',
		workflow_triggered: 'workflowTriggered',
		daily_summary: 'dailySummary',
	}
	return map[type] as never
}

export async function createNotification(
	userId: string,
	type: NotificationType,
	title: string,
	message: string,
	leadId: string | null = null,
): Promise<void> {
	try {
		const settings = await Settings.findOne({ userId })
		const pref = settings?.notifications?.[typeToPref(type)]
		if (pref === false) return

		await Notification.create({ userId, type, title, message, leadId })
	} catch (err) {
		logger.error('[notifications] failed to create:', (err as Error).message)
	}
}
