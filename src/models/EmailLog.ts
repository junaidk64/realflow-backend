import mongoose, { Document, Schema } from 'mongoose'

export type EmailLogType = 'incoming' | 'outgoing'
export type EmailLogStatus = 'pending' | 'sent' | 'failed' | 'delivered'

export interface IEmailLog extends Document {
	userId: mongoose.Types.ObjectId
	leadId: mongoose.Types.ObjectId | null
	type: EmailLogType
	from: string
	to: string
	subject: string
	body: string
	htmlBody: string
	gmailMessageId: string
	status: EmailLogStatus
	error: string | null
	sentAt: Date | null
	createdAt: Date
	updatedAt: Date
}

const EmailLogSchema = new Schema<IEmailLog>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
		leadId: {
			type: Schema.Types.ObjectId,
			ref: 'Lead',
			default: null,
		},
		type: {
			type: String,
			enum: ['incoming', 'outgoing'],
			required: true,
		},
		from: {
			type: String,
			default: '',
		},
		to: {
			type: String,
			default: '',
		},
		subject: {
			type: String,
			default: '',
		},
		body: {
			type: String,
			default: '',
		},
		htmlBody: {
			type: String,
			default: '',
		},
		gmailMessageId: {
			type: String,
			default: '',
		},
		status: {
			type: String,
			enum: ['pending', 'sent', 'failed', 'delivered'],
			default: 'pending',
		},
		error: {
			type: String,
			default: null,
		},
		sentAt: {
			type: Date,
			default: null,
		},
	},
	{
		timestamps: true,
		toJSON: {
			transform: (_doc, ret) => {
				// delete ret._v;
				return ret
			},
		},
	},
)

EmailLogSchema.index({ userId: 1, createdAt: -1 })
EmailLogSchema.index({ leadId: 1 })
EmailLogSchema.index({ gmailMessageId: 1 })

export const EmailLog = mongoose.model<IEmailLog>('EmailLog', EmailLogSchema)
export default EmailLog
