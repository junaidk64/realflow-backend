import mongoose, { Document, Schema } from 'mongoose'

export interface ISmtpConnection extends Document {
  userId: mongoose.Types.ObjectId
  fromName: string
  fromEmail: string
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  isActive: boolean
  lastTestedAt: Date | null
  testError: string | null
  createdAt: Date
  updatedAt: Date
}

const SmtpConnectionSchema = new Schema<ISmtpConnection>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    fromName: { type: String, default: '' },
    fromEmail: { type: String, required: true, lowercase: true, trim: true },
    host: { type: String, required: true },
    port: { type: Number, required: true, default: 587 },
    secure: { type: Boolean, default: false },
    user: { type: String, required: true },
    password: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    lastTestedAt: { type: Date, default: null },
    testError: { type: String, default: null },
  },
  { timestamps: true },
)

SmtpConnectionSchema.index({ userId: 1 })

export const SmtpConnection = mongoose.model<ISmtpConnection>(
  'SmtpConnection',
  SmtpConnectionSchema,
)
export default SmtpConnection
