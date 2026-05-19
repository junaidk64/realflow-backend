import mongoose, { Document, Schema } from 'mongoose'

export interface IOrganization extends Document {
	name: string
	ownerId: mongoose.Types.ObjectId
	createdAt: Date
	updatedAt: Date
}

const OrganizationSchema = new Schema<IOrganization>(
	{
		name: {
			type: String,
			required: true,
			trim: true,
		},
		ownerId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
	},
	{ timestamps: true },
)

export const Organization = mongoose.model<IOrganization>('Organization', OrganizationSchema)
export default Organization
