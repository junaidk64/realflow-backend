import mongoose, { Document, Schema } from 'mongoose'

export interface IGmailConnection extends Document {
	userId: mongoose.Types.ObjectId
	email: string
	accessToken: string
	refreshToken: string
	tokenExpiry: Date
	historyId: string
	watchExpiry: Date | null
	isActive: boolean
	lastSyncAt: Date | null
	syncError: string | null
	createdAt: Date
	updatedAt: Date
}

const GmailConnectionSchema = new Schema<IGmailConnection>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			unique: true,
		},
		email: {
			type: String,
			required: true,
			lowercase: true,
			trim: true,
		},
		accessToken: {
			type: String,
			required: true,
		},
		refreshToken: {
			type: String,
			required: true,
		},
		tokenExpiry: {
			type: Date,
			required: true,
		},
		historyId: {
			type: String,
			default: '',
		},
		watchExpiry: {
			type: Date,
			default: null,
		},
		isActive: {
			type: Boolean,
			default: true,
		},
		lastSyncAt: {
			type: Date,
			default: null,
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

GmailConnectionSchema.index({ userId: 1 })
GmailConnectionSchema.index({ isActive: 1 })
GmailConnectionSchema.index({ watchExpiry: 1 })

export const GmailConnection = mongoose.model<IGmailConnection>(
	'GmailConnection',
	GmailConnectionSchema,
)
export default GmailConnection
