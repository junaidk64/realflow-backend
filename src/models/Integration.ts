import { Document, Schema, Types, model } from 'mongoose'

export interface IIntegration extends Document {
	agentId: Types.ObjectId
	integrationId: string
	status: 'connected' | 'disconnected'
	config: string // AES-256-GCM encrypted JSON blob
	connectedAt?: Date
	createdAt: Date
	updatedAt: Date
}

const IntegrationSchema = new Schema<IIntegration>(
	{
		agentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		integrationId: { type: String, required: true },
		status: {
			type: String,
			enum: ['connected', 'disconnected'],
			default: 'disconnected',
		},
		config: { type: String, default: '' },
		connectedAt: { type: Date },
	},
	{ timestamps: true },
)

IntegrationSchema.index({ agentId: 1, integrationId: 1 }, { unique: true })

export default model<IIntegration>('Integration', IntegrationSchema)
