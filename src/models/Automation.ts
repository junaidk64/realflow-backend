import { Document, Schema, model } from 'mongoose'

export interface IAutomation extends Document {
	// Global seeded automations are not tied to a specific user.
	name: string
	description?: string
	trigger:
		| 'lead-created'
		| 'status-changed'
		| 'appointment-set'
		| 'listing-published'
		| 'manual'
	n8nWorkflowId: string
	workflowKey: string
	requiredPlan: 'trial' | 'starter' | 'pro' | 'brokerage'
	isSeeded: boolean
	isActive: boolean
	runCount: number
	lastRunAt?: Date
	createdAt: Date
}

const AutomationSchema = new Schema<IAutomation>({
	name: { type: String, required: true },
	description: String,
	trigger: {
		type: String,
		enum: [
			'lead-created',
			'status-changed',
			'appointment-set',
			'listing-published',
			'manual',
		],
		required: true,
	},
	n8nWorkflowId: { type: String, required: true },
	// Stable identifier matching SEEDED_WORKFLOWS (e.g. "wf-001")
	workflowKey: { type: String, required: true },
	// Minimum plan tier needed to enable this workflow
	requiredPlan: {
		type: String,
		enum: ['trial', 'starter', 'pro', 'brokerage'],
		required: true,
	},
	// True for the 4 platform-seeded automations; users cannot create their own
	isSeeded: { type: Boolean, default: false },
	// `isActive` on the global automation is informational; user enablement
	// is tracked on the `User.n8nWorkflowsEnabled` array.
	isActive: { type: Boolean, default: false },
	runCount: { type: Number, default: 0 },
	lastRunAt: Date,
	createdAt: { type: Date, default: Date.now },
})

// Unique workflowKey for global seeded automations
AutomationSchema.index({ workflowKey: 1 }, { unique: true, sparse: false })

export default model<IAutomation>('Automation', AutomationSchema)
