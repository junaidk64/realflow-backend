import mongoose, { Document, Schema } from 'mongoose'

export interface IWhatsAppConnection extends Document {
	userId: mongoose.Types.ObjectId
	organizationId: mongoose.Types.ObjectId | null
	// Meta API credentials
	phoneNumberId: string         // WhatsApp Phone Number ID from Meta dashboard
	wabaId: string                // WhatsApp Business Account ID
	displayPhoneNumber: string    // Human-readable e.g. "+1 555 000 0000"
	accessToken: string           // Encrypted permanent system user token
	verifyToken: string           // Encrypted webhook verify token (set by user in Meta dashboard)
	appSecret: string             // Encrypted Meta App Secret (for signature validation)
	isActive: boolean
	lastMessageAt: Date | null
	messageCount: number
	syncError: string | null
	createdAt: Date
	updatedAt: Date
}

const WhatsAppConnectionSchema = new Schema<IWhatsAppConnection>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
		organizationId: {
			type: Schema.Types.ObjectId,
			ref: 'Organization',
			default: null,
			index: true,
		},
		phoneNumberId: {
			type: String,
			required: true,
		},
		wabaId: {
			type: String,
			required: true,
		},
		displayPhoneNumber: {
			type: String,
			default: '',
		},
		accessToken: {
			type: String,
			required: true,
		},
		verifyToken: {
			type: String,
			required: true,
		},
		appSecret: {
			type: String,
			required: true,
		},
		isActive: {
			type: Boolean,
			default: true,
		},
		lastMessageAt: {
			type: Date,
			default: null,
		},
		messageCount: {
			type: Number,
			default: 0,
		},
		syncError: {
			type: String,
			default: null,
		},
	},
	{
		timestamps: true,
	},
)

WhatsAppConnectionSchema.index({ userId: 1 })
WhatsAppConnectionSchema.index({ organizationId: 1 })
WhatsAppConnectionSchema.index({ phoneNumberId: 1 })
WhatsAppConnectionSchema.index({ isActive: 1 })

export const WhatsAppConnection = mongoose.model<IWhatsAppConnection>(
	'WhatsAppConnection',
	WhatsAppConnectionSchema,
)
export default WhatsAppConnection
