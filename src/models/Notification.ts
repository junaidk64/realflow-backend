import mongoose, { Document, Schema } from 'mongoose'

export type NotificationType = 'new_lead' | 'auto_reply_sent' | 'workflow_triggered' | 'daily_summary'

export interface INotification extends Document {
	userId: mongoose.Types.ObjectId
	type: NotificationType
	title: string
	message: string
	read: boolean
	leadId: mongoose.Types.ObjectId | null
	createdAt: Date
	updatedAt: Date
}

const NotificationSchema = new Schema<INotification>(
	{
		userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
		type: {
			type: String,
			enum: ['new_lead', 'auto_reply_sent', 'workflow_triggered', 'daily_summary'],
			required: true,
		},
		title: { type: String, required: true },
		message: { type: String, required: true },
		read: { type: Boolean, default: false },
		leadId: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
	},
	{ timestamps: true },
)

NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 })

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema)
export default Notification
