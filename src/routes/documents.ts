import { Router } from "express";
import { z } from "zod";
import { verifyFirebaseToken } from "../middleware/auth";
import { rateLimiter } from "../middleware/rateLimit";
import User from "../models/User";
import Document from "../models/Document";

const router = Router();
router.use(verifyFirebaseToken);
router.use(rateLimiter);

const createDocumentSchema = z.object({
  leadId: z.string().optional(),
  name: z.string().min(1),
  fileUrl: z.string().url(),
  key: z.string().optional(),
});

// GET /api/documents
router.get("/", async (req, res) => {
  try {
    const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    const documents = await Document.find({ agentId: dbUser._id })
      .sort({ createdAt: -1 })
      .populate("leadId", "name email")
      .lean();

    return res.json({ documents });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/documents
router.post("/", async (req, res) => {
  try {
    const parsed = createDocumentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    const document = await Document.create({ ...parsed.data, agentId: dbUser._id });
    return res.status(201).json({ document });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/documents/:id
router.patch("/:id", async (req, res) => {
  try {
    const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    const document = await Document.findOneAndUpdate(
      { _id: req.params.id, agentId: dbUser._id },
      req.body,
      { new: true }
    );
    if (!document) return res.status(404).json({ error: "Document not found" });
    return res.json({ document });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/documents/:id
router.delete("/:id", async (req, res) => {
  try {
    const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    await Document.findOneAndDelete({ _id: req.params.id, agentId: dbUser._id });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
