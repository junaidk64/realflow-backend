import mongoose, { Document, Schema } from 'mongoose'

export type BusinessType = 'moving' | 'real_estate' | 'insurance' | 'cleaning' | 'legal' | 'general'
export type TemplateStatus = 'draft' | 'pending' | 'approved' | 'rejected'

export interface ITemplate extends Document {
  userId: mongoose.Types.ObjectId
  name: string
  description: string
  htmlContent: string
  businessType: BusinessType
  tags: string[]
  status: TemplateStatus
  publishedAt: Date | null
  rejectionReason: string | null
  createdAt: Date
  updatedAt: Date
}

const TemplateSchema = new Schema<ITemplate>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Template name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, 'Description cannot exceed 300 characters'],
      default: '',
    },
    htmlContent: {
      type: String,
      required: [true, 'HTML content is required'],
    },
    businessType: {
      type: String,
      enum: ['moving', 'real_estate', 'insurance', 'cleaning', 'legal', 'general'],
      required: true,
      index: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ['draft', 'pending', 'approved', 'rejected'],
      default: 'draft',
      index: true,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
)

TemplateSchema.index({ userId: 1, status: 1 })
TemplateSchema.index({ userId: 1, businessType: 1 })
TemplateSchema.index({ status: 1, businessType: 1 })

export const Template = mongoose.model<ITemplate>('Template', TemplateSchema)
export default Template
