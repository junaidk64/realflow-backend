import { Schema, model, Document, Types } from "mongoose";

export interface ISubscription extends Document {
  userId: Types.ObjectId;
  paddleSubscriptionId?: string;
  paddleCustomerId?: string;
  plan?: "starter" | "pro" | "brokerage";
  status?: "active" | "past_due" | "cancelled" | "paused";
  currentPeriodEnd?: Date;
  cancelledAt?: Date;
  createdAt: Date;
}

const SubscriptionSchema = new Schema<ISubscription>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  paddleSubscriptionId: { type: String, unique: true, sparse: true },
  paddleCustomerId: String,
  plan: { type: String, enum: ["starter", "pro", "brokerage"] },
  status: { type: String, enum: ["active", "past_due", "cancelled", "paused"] },
  currentPeriodEnd: Date,
  cancelledAt: Date,
  createdAt: { type: Date, default: Date.now },
});

export default model<ISubscription>("Subscription", SubscriptionSchema);
