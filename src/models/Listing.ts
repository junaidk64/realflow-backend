import { Document, Schema, Types, model } from 'mongoose'

export interface IListing extends Document {
	agentId: Types.ObjectId
	title?: string
	address: {
		street?: string
		city?: string
		state?: string
		zip?: string
		country: string
		coordinates?: [number, number] // [longitude, latitude]
		latitude?: number
		longitude?: number
		type?: 'Point'
	}
	price?: number
	bedrooms?: number
	bathrooms?: number
	sqft?: number
	propertyType?: 'house' | 'condo' | 'townhouse' | 'land' | 'commercial'
	listingType?: 'sale' | 'rent'
	features: string[]
	description?: string
	images: string[]
	status: 'draft' | 'active' | 'under-contract' | 'sold'
	mlsNumber?: string
	createdAt: Date
}

const ListingSchema = new Schema<IListing>({
	agentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
	title: String,
	address: {
		street: String,
		city: String,
		state: String,
		zip: String,
		country: { type: String, default: 'US' },
		coordinates: [Number], // [longitude, latitude]
		type: { type: String, enum: ['Point'], default: 'Point' },
		latitude: Number,
		longitude: Number,
	},
	price: Number,
	bedrooms: Number,
	bathrooms: Number,
	sqft: Number,
	propertyType: {
		type: String,
		enum: ['house', 'condo', 'townhouse', 'land', 'commercial'],
	},
	listingType: { type: String, enum: ['sale', 'rent'] },
	features: [String],
	description: String,
	images: [String],
	status: {
		type: String,
		enum: ['draft', 'active', 'under-contract', 'sold'],
		default: 'draft',
	},
	mlsNumber: String,
	createdAt: { type: Date, default: Date.now },
})

ListingSchema.index({ agentId: 1, createdAt: -1 })
ListingSchema.index({ agentId: 1, status: 1 })

export default model<IListing>('Listing', ListingSchema)
