import mongoose, { Document, Schema } from 'mongoose'

export type LeadStatus = 'new' | 'contacted' | 'quoted' | 'won' | 'lost'
export type LeadSource = 'email' | 'manual' | 'webhook'

export interface ILead extends Document {
	userId: mongoose.Types.ObjectId
	source: LeadSource
	rawEmailId: string
	customerName: string
	customerEmail: string
	customerPhone: string
	movingDate: string
	fromAddress: string
	toAddress: string
	services: string[]
	notes: string
	status: LeadStatus
	autoReplySent: boolean
	autoReplySentAt: Date | null
	n8nTriggered: boolean
	n8nTriggeredAt: Date | null
	emailLogId: mongoose.Types.ObjectId | null
	confidence: number
	rawEmailSubject: string
	rawEmailFrom: string
	createdAt: Date
	updatedAt: Date
}

const LeadSchema = new Schema<ILead>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
		source: {
			type: String,
			enum: ['email', 'manual', 'webhook'],
			default: 'email',
		},
		rawEmailId: {
			type: String,
			default: '',
		},
		customerName: {
			type: String,
			trim: true,
			default: '',
		},
		customerEmail: {
			type: String,
			lowercase: true,
			trim: true,
			default: '',
		},
		customerPhone: {
			type: String,
			trim: true,
			default: '',
		},
		movingDate: {
			type: String,
			default: '',
		},
		fromAddress: {
			type: String,
			default: '',
		},
		toAddress: {
			type: String,
			default: '',
		},
		services: {
			type: [String],
			default: [],
		},
		notes: {
			type: String,
			default: '',
		},
		status: {
			type: String,
			enum: ['new', 'contacted', 'quoted', 'won', 'lost'],
			default: 'new',
		},
		autoReplySent: {
			type: Boolean,
			default: false,
		},
		autoReplySentAt: {
			type: Date,
			default: null,
		},
		n8nTriggered: {
			type: Boolean,
			default: false,
		},
		n8nTriggeredAt: {
			type: Date,
			default: null,
		},
		emailLogId: {
			type: Schema.Types.ObjectId,
			ref: 'EmailLog',
			default: null,
		},
		confidence: {
			type: Number,
			min: 0,
			max: 100,
			default: 0,
		},
		rawEmailSubject: {
			type: String,
			default: '',
		},
		rawEmailFrom: {
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

LeadSchema.index({ userId: 1, createdAt: -1 })
LeadSchema.index({ userId: 1, status: 1 })
LeadSchema.index({ userId: 1, customerEmail: 1 })
LeadSchema.index({ rawEmailId: 1 })

export const Lead = mongoose.model<ILead>('Lead', LeadSchema)
export default Lead
