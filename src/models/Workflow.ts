import mongoose, { Document, Schema } from 'mongoose'

export interface IWorkflowConfig {
	templateId: mongoose.Types.ObjectId | null
	templateName: string | null
	subject: string | null
	fallbackToGlobal: boolean
	[key: string]: unknown
}

export interface IWorkflow extends Document {
	userId: mongoose.Types.ObjectId
	name: string
	description: string
	n8nWorkflowId: string
	type: 'lead_extraction' | 'auto_reply' | 'notification' | 'custom'
	isActive: boolean
	triggerCount: number
	lastTriggered: Date | null
	config: IWorkflowConfig
	webhookUrl: string
	createdAt: Date
	updatedAt: Date
}

const WorkflowConfigSchema = new Schema<IWorkflowConfig>(
	{
		templateId: { type: Schema.Types.ObjectId, ref: 'Template', default: null },
		templateName: { type: String, default: null },
		subject: { type: String, default: null },
		fallbackToGlobal: { type: Boolean, default: true },
	},
	{ _id: false, strict: false },
)

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
			type: WorkflowConfigSchema,
			default: () => ({}),
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
				return ret
			},
		},
	},
)

WorkflowSchema.index({ userId: 1 })
WorkflowSchema.index({ userId: 1, isActive: 1 })

export const Workflow = mongoose.model<IWorkflow>('Workflow', WorkflowSchema)
export default Workflow
