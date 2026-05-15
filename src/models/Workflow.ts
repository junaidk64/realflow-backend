import mongoose, { Document, Schema } from 'mongoose'

export interface IWorkflow extends Document {
	userId: mongoose.Types.ObjectId
	name: string
	description: string
	n8nWorkflowId: string
	type: 'lead_extraction' | 'auto_reply' | 'notification' | 'custom'
	isActive: boolean
	triggerCount: number
	lastTriggered: Date | null
	config: Record<string, unknown>
	webhookUrl: string
	createdAt: Date
	updatedAt: Date
}

const WorkflowSchema = new Schema<IWorkflow>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
		name: {
			type: String,
			required: true,
			trim: true,
		},
		description: {
			type: String,
			default: '',
		},
		n8nWorkflowId: {
			type: String,
			default: '',
		},
		type: {
			type: String,
			enum: ['lead_extraction', 'auto_reply', 'notification', 'custom'],
			default: 'custom',
		},
		isActive: {
			type: Boolean,
			default: false,
		},
		triggerCount: {
			type: Number,
			default: 0,
		},
		lastTriggered: {
			type: Date,
			default: null,
		},
		config: {
			type: Schema.Types.Mixed,
			default: {},
		},
		webhookUrl: {
			type: String,
			default: '',
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

WorkflowSchema.index({ userId: 1 })
WorkflowSchema.index({ userId: 1, isActive: 1 })

export const Workflow = mongoose.model<IWorkflow>('Workflow', WorkflowSchema)
export default Workflow
