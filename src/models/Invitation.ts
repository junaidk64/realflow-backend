import mongoose, { Document, Schema } from 'mongoose'

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'
export type InvitationRole = 'admin' | 'manager' | 'member'

export interface IInvitation extends Document {
	email: string
	role: InvitationRole
	permissions: string[]
	organizationId: mongoose.Types.ObjectId
	invitedBy: mongoose.Types.ObjectId
	token: string
	status: InvitationStatus
	expiresAt: Date
	createdAt: Date
	updatedAt: Date
}

const InvitationSchema = new Schema<IInvitation>(
	{
		email: {
			type: String,
			required: true,
			lowercase: true,
			trim: true,
		},
		role: {
			type: String,
			enum: ['admin', 'manager', 'member'],
			required: true,
		},
		permissions: {
			type: [String],
			default: [],
		},
		organizationId: {
			type: Schema.Types.ObjectId,
			ref: 'Organization',
			required: true,
		},
		invitedBy: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
		token: {
			type: String,
			required: true,
			unique: true,
		},
		status: {
			type: String,
			enum: ['pending', 'accepted', 'expired', 'revoked'],
			default: 'pending',
		},
		expiresAt: {
			type: Date,
			required: true,
		},
	},
	{ timestamps: true },
)

InvitationSchema.index({ token: 1 }, { unique: true })
InvitationSchema.index({ email: 1, organizationId: 1 })
InvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const Invitation = mongoose.model<IInvitation>('Invitation', InvitationSchema)
export default Invitation
