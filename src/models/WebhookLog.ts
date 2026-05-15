import mongoose, { Document, Schema } from 'mongoose'

export interface IWebhookLog extends Document {
	type: 'gmail_push' | 'n8n_callback' | 'outgoing_n8n'
	payload: Record<string, unknown>
	status: 'received' | 'processing' | 'processed' | 'failed'
	error: string | null
	processedAt: Date | null
	userId: mongoose.Types.ObjectId | null
	createdAt: Date
	updatedAt: Date
}

const WebhookLogSchema = new Schema<IWebhookLog>(
	{
		type: {
			type: String,
			enum: ['gmail_push', 'n8n_callback', 'outgoing_n8n'],
			required: true,
		},
		payload: {
			type: Schema.Types.Mixed,
			default: {},
		},
		status: {
			type: String,
			enum: ['received', 'processing', 'processed', 'failed'],
			default: 'received',
		},
		error: {
			type: String,
			default: null,
		},
		processedAt: {
			type: Date,
			default: null,
		},
		userId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			default: null,
		},
	},
	{
		timestamps: true,
		toJSON: {
			transform: (_doc, ret) => {
				// delete ret.__v;
				return ret
			},
		},
	},
)

WebhookLogSchema.index({ type: 1, createdAt: -1 })
WebhookLogSchema.index({ status: 1 })

export const WebhookLog = mongoose.model<IWebhookLog>(
	'WebhookLog',
	WebhookLogSchema,
)
export default WebhookLog
