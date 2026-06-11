import mongoose, { Document, Schema } from 'mongoose'

export interface IWhatsAppConnection extends Document {
	userId: mongoose.Types.ObjectId
	organizationId: mongoose.Types.ObjectId | null
	// Meta identifiers — obtained via Embedded Signup, never entered manually
	phoneNumberId: string         // WhatsApp Phone Number ID
	wabaId: string                // WhatsApp Business Account ID
	displayPhoneNumber: string    // Human-readable e.g. "+1 555 000 0000"
	verifiedName: string          // Business display name from Meta
	// Encrypted OAuth access token obtained via Embedded Signup code exchange
	accessToken: string
	tokenExpiry: Date | null      // When the access token expires (null = permanent)
	// Meta user who authorised the connection
	metaUserId: string | null
	// OAuth scopes granted by the user
	scope: string | null
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
		verifiedName: {
			type: String,
			default: '',
		},
		accessToken: {
			type: String,
			required: true,
		},
		tokenExpiry: {
			type: Date,
			default: null,
		},
		metaUserId: {
			type: String,
			default: null,
		},
		scope: {
			type: String,
			default: null,
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
