import mongoose, { Document, Schema } from 'mongoose'

export type EmailLogType = 'incoming' | 'outgoing'
export type EmailLogStatus = 'pending' | 'sent' | 'failed' | 'delivered'
export type MessageChannel = 'email' | 'whatsapp'
export type WhatsAppMessageType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'template' | 'interactive' | 'sticker' | 'location'
export type WhatsAppDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed'

export interface IEmailLog extends Document {
	userId: mongoose.Types.ObjectId
	leadId: mongoose.Types.ObjectId | null
	type: EmailLogType
	// ── channel discrimination ────────────────────────────────────────────────
	channel: MessageChannel
	// ── email fields (populated for channel='email') ──────────────────────────
	from: string
	to: string
	subject: string
	body: string
	htmlBody: string
	gmailMessageId: string
	// ── whatsapp fields (populated for channel='whatsapp') ────────────────────
	whatsappMessageId: string
	whatsappPhone: string
	messageType: WhatsAppMessageType | null
	mediaUrl: string | null
	deliveryStatus: WhatsAppDeliveryStatus | null
	// ── shared ────────────────────────────────────────────────────────────────
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
		channel: {
			type: String,
			enum: ['email', 'whatsapp'],
			default: 'email',
		},
		whatsappMessageId: {
			type: String,
			default: '',
		},
		whatsappPhone: {
			type: String,
			default: '',
		},
		messageType: {
			type: String,
			enum: ['text', 'image', 'video', 'audio', 'document', 'template', 'interactive', 'sticker', 'location'],
			default: null,
		},
		mediaUrl: {
			type: String,
			default: null,
		},
		deliveryStatus: {
			type: String,
			enum: ['sent', 'delivered', 'read', 'failed'],
			default: null,
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
EmailLogSchema.index({ whatsappMessageId: 1 })
EmailLogSchema.index({ leadId: 1, channel: 1, createdAt: -1 })

export const EmailLog = mongoose.model<IEmailLog>('EmailLog', EmailLogSchema)
export default EmailLog
