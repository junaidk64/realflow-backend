import { Schema, model, Document as MDocument, Types } from "mongoose";

export interface IDocument extends MDocument {
  agentId: Types.ObjectId;
  leadId?: Types.ObjectId;
  name: string;
  fileUrl: string;
  key: string;
  signingStatus: "pending" | "signed" | "rejected";
  createdAt: Date;
}

const DocumentSchema = new Schema<IDocument>({
  agentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  leadId: { type: Schema.Types.ObjectId, ref: "Lead" },
  name: { type: String, required: true },
  fileUrl: { type: String, required: true },
  key: String,
  signingStatus: {
    type: String,
    enum: ["pending", "signed", "rejected"],
    default: "pending",
  },
  createdAt: { type: Date, default: Date.now },
});

export default model<IDocument>("Document", DocumentSchema);
