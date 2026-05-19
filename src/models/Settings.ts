import mongoose, { Document, Schema } from 'mongoose'

export type BusinessType = 'moving' | 'real_estate' | 'insurance' | 'cleaning' | 'legal' | 'general'

export interface ISettings extends Document {
	userId: mongoose.Types.ObjectId
	organizationId: mongoose.Types.ObjectId | null
	businessType: BusinessType
	businessName: string
	autoReply: boolean
	autoReplyTemplate: string
	autoReplySubject: string
	n8nWebhookUrl: string
	emailSignature: string
	notifications: {
		newLead: boolean
		autoReplySent: boolean
		workflowTriggered: boolean
		dailySummary: boolean
		emailAddress: string
	}
	minimumConfidence: number
	createdAt: Date
	updatedAt: Date
}

const SettingsSchema = new Schema<ISettings>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			unique: true,
		},
		organizationId: {
			type: Schema.Types.ObjectId,
			ref: 'Organization',
			default: null,
			sparse: true,
		},
		businessType: {
			type: String,
			enum: ['moving', 'real_estate', 'insurance', 'cleaning', 'legal', 'general'],
			default: 'general',
		},
		businessName: {
			type: String,
			default: '',
		},
		autoReply: {
			type: Boolean,
			default: true,
		},
		autoReplyTemplate: {
			type: String,
			default:
				'Thank you for your enquiry! We have received your request and will be in touch within 2 hours with our best offer.',
		},
		autoReplySubject: {
			type: String,
			default: "Thank you for your enquiry - We'll be in touch soon!",
		},
		n8nWebhookUrl: {
			type: String,
			default: '',
		},
		emailSignature: {
			type: String,
			default: '',
		},
		notifications: {
			type: {
				newLead: { type: Boolean, default: true },
				autoReplySent: { type: Boolean, default: true },
				workflowTriggered: { type: Boolean, default: false },
				dailySummary: { type: Boolean, default: true },
				emailAddress: { type: String, default: '' },
			},
			default: {
				newLead: true,
				autoReplySent: true,
				workflowTriggered: false,
				dailySummary: true,
				emailAddress: '',
			},
		},
		minimumConfidence: {
			type: Number,
			min: 0,
			max: 100,
			default: 40,
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

SettingsSchema.index({ userId: 1 })
SettingsSchema.index({ organizationId: 1 }, { sparse: true })

export const Settings = mongoose.model<ISettings>('Settings', SettingsSchema)
export default Settings
