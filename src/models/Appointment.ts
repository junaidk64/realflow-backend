import { Schema, model, Document, Types } from "mongoose";

export interface IAppointment extends Document {
  agentId: Types.ObjectId;
  leadId?: Types.ObjectId;
  listingId?: Types.ObjectId;
  title?: string;
  scheduledAt: Date;
  duration: number;
  location?: string;
  notes?: string;
  status: "scheduled" | "completed" | "cancelled" | "no-show";
  reminderSent: boolean;
  createdAt: Date;
}

const AppointmentSchema = new Schema<IAppointment>({
  agentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  leadId: { type: Schema.Types.ObjectId, ref: "Lead" },
  listingId: { type: Schema.Types.ObjectId, ref: "Listing" },
  title: String,
  scheduledAt: { type: Date, required: true },
  duration: { type: Number, default: 60 },
  location: String,
  notes: String,
  status: {
    type: String,
    enum: ["scheduled", "completed", "cancelled", "no-show"],
    default: "scheduled",
  },
  reminderSent: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

export default model<IAppointment>("Appointment", AppointmentSchema);
