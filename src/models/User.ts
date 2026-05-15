import mongoose, { Document, Schema } from 'mongoose'

export interface IUser extends Document {
	name: string
	email: string
	googleId: string
	avatar?: string
	role: 'admin' | 'user'
	isActive: boolean
	lastLogin?: Date
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
			required: true,
			unique: true,
		},
		avatar: {
			type: String,
			default: null,
		},
		role: {
			type: String,
			enum: ['admin', 'user'],
			default: 'user',
		},
		isActive: {
			type: Boolean,
			default: true,
		},
		lastLogin: {
			type: Date,
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

UserSchema.index({ email: 1 })
UserSchema.index({ googleId: 1 })

export const User = mongoose.model<IUser>('User', UserSchema)
export default User
