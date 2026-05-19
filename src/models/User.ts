import mongoose, { Document, Schema } from 'mongoose'

export type UserPlan = 'free' | 'basic' | 'pro'
export type UserRole = 'root' | 'admin' | 'manager' | 'member'

export interface IUser extends Document {
	name: string
	email: string
	googleId: string
	avatar?: string
	role: UserRole
	permissions: string[]
	organizationId: mongoose.Types.ObjectId | null
	invitedBy: mongoose.Types.ObjectId | null
	password?: string
	isActive: boolean
	lastLogin?: Date
	plan: UserPlan
	stripeCustomerId: string | null
	stripeSubscriptionId: string | null
	createdAt: Date
	updatedAt: Date
}

const UserSchema = new Schema<IUser>(
	{
		name: {
			type: String,
			required: true,
			trim: true,
			maxlength: 100,
		},
		email: {
			type: String,
			required: true,
			unique: true,
			lowercase: true,
			trim: true,
		},
		googleId: {
			type: String,
			unique: true,
			sparse: true,
			default: null,
		},
		avatar: {
			type: String,
			default: null,
		},
		role: {
			type: String,
			enum: ['root', 'admin', 'manager', 'member'],
			default: 'member',
		},
		permissions: {
			type: [String],
			default: [],
		},
		organizationId: {
			type: Schema.Types.ObjectId,
			ref: 'Organization',
			default: null,
		},
		invitedBy: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			default: null,
		},
		password: {
			type: String,
			default: null,
		},
		isActive: {
			type: Boolean,
			default: true,
		},
		lastLogin: {
			type: Date,
			default: null,
		},
		plan: {
			type: String,
			enum: ['free', 'basic', 'pro'],
			default: 'free',
		},
		stripeCustomerId: {
			type: String,
			default: null,
		},
		stripeSubscriptionId: {
			type: String,
			default: null,
		},
	},
	{
		timestamps: true,
		toJSON: {
			transform: (_doc, ret) => {
				delete ret.password
				return ret
			},
		},
	},
)

UserSchema.index({ email: 1 })
UserSchema.index({ googleId: 1 })

export const User = mongoose.model<IUser>('User', UserSchema)
export default User
