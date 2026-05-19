import mongoose, { Document, Schema } from 'mongoose'

export interface IUsageLog extends Document {
  userId: mongoose.Types.ObjectId
  aiModel: string
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  costUsd: number
  createdAt: Date
}

const UsageLogSchema = new Schema<IUsageLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    aiModel: { type: String, required: true },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    cachedTokens: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },
  },
  { timestamps: true },
)

UsageLogSchema.index({ userId: 1, createdAt: -1 })

export const UsageLog = mongoose.model<IUsageLog>('UsageLog', UsageLogSchema)
export default UsageLog
