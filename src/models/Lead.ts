import { Document, Schema, Types, model } from 'mongoose'

export interface IActivity {
	type:
		| 'email'
		| 'sms'
		| 'whatsapp'
		| 'call'
		| 'note'
		| 'status-change'
		| 'viewing'
	content?: string
	createdAt: Date
}

export interface ILead extends Document {
	agentId: Types.ObjectId
	name: string
	email?: string
	phone?: string
	source?: 'website' | 'referral' | 'zillow' | 'cold-call' | 'social' | 'other'
	status:
		| 'new'
		| 'contacted'
		| 'viewing-scheduled'
		| 'offer-made'
		| 'closed-won'
		| 'closed-lost'
		| 'nurture'
	propertyType?:
		| 'buy'
		| 'sell'
		| 'rent'
		| 'house'
		| 'condo'
		| 'apartment'
		| 'townhouse'
		| 'land'
		| 'commercial'
		| 'other'
	budget?: number
	preferredAreas: string[]
	bedrooms?: number
	notes?: string
	tags: string[]
	assignedListingId?: Types.ObjectId
	lastContactedAt?: Date
	nextFollowUpAt?: Date
	portalToken?: string
	activities: IActivity[]
	createdAt: Date
	updatedAt: Date
}

const LeadSchema = new Schema<ILead>({
	agentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
	name: { type: String, required: true },
	email: String,
	phone: String,
	source: {
		type: String,
		enum: ['website', 'referral', 'zillow', 'cold-call', 'social', 'other'],
	},
	status: {
		type: String,
		enum: [
			'new',
			'contacted',
			'viewing-scheduled',
			'offer-made',
			'closed-won',
			'closed-lost',
			'nurture',
		],
		default: 'new',
	},
	propertyType: {
		type: String,
		enum: [
			'buy',
			'sell',
			'rent',
			'house',
			'condo',
			'townhouse',
			'land',
			'apartment',
			'commercial',
			'other',
		],
	},
	budget: Number,
	preferredAreas: [String],
	bedrooms: Number,
	notes: String,
	tags: [String],
	assignedListingId: { type: Schema.Types.ObjectId, ref: 'Listing' },
	lastContactedAt: Date,
	nextFollowUpAt: Date,
	portalToken: { type: String, unique: true, sparse: true },
	activities: [
		{
			type: {
				type: String,
				enum: [
					'email',
					'sms',
					'whatsapp',
					'call',
					'note',
					'status-change',
					'viewing',
				],
			},
			content: String,
			createdAt: { type: Date, default: Date.now },
		},
	],
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
})

LeadSchema.index({ agentId: 1, createdAt: -1 })
LeadSchema.index({ agentId: 1, status: 1 })

export default model<ILead>('Lead', LeadSchema)
