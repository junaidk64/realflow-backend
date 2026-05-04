import { Schema, model, Document } from "mongoose";

export interface IUser extends Document {
  firebaseUid: string;
  name?: string;
  email?: string;
  image?: string;
  plan: "trial" | "starter" | "pro" | "brokerage";
  paddleCustomerId?: string;
  paddleSubscriptionId?: string;
  subscriptionStatus: "trialing" | "active" | "past_due" | "cancelled" | "paused";
  currentPeriodEnd?: Date;
  trialEndsAt?: Date;
  agencyName?: string;
  phone?: string;
  timezone: string;
  n8nWorkflowsEnabled: string[];
  createdAt: Date;
}

const UserSchema = new Schema<IUser>({
  firebaseUid: { type: String, unique: true, required: true },
  name: String,
  email: { type: String, unique: true, sparse: true },
  image: String,
  plan: {
    type: String,
    enum: ["trial", "starter", "pro", "brokerage"],
    default: "trial",
  },
  paddleCustomerId: String,
  paddleSubscriptionId: String,
  subscriptionStatus: {
    type: String,
    enum: ["trialing", "active", "past_due", "cancelled", "paused"],
    default: "trialing",
  },
  currentPeriodEnd: Date,
  trialEndsAt: Date,
  agencyName: String,
  phone: String,
  timezone: { type: String, default: "America/New_York" },
  n8nWorkflowsEnabled: [String],
  createdAt: { type: Date, default: Date.now },
});

export default model<IUser>("User", UserSchema);
