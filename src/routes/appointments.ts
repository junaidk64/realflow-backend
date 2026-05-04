import { Router } from "express";
import { z } from "zod";
import { verifyFirebaseToken } from "../middleware/auth";
import { rateLimiter } from "../middleware/rateLimit";
import User from "../models/User";
import Appointment from "../models/Appointment";
import { triggerN8nWebhook } from "../lib/n8n";

const router = Router();
router.use(verifyFirebaseToken);
router.use(rateLimiter);

const createAppointmentSchema = z.object({
  leadId: z.string().optional(),
  listingId: z.string().optional(),
  title: z.string().optional(),
  scheduledAt: z.string(),
  duration: z.number().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
});

// GET /api/appointments
router.get("/", async (req, res) => {
  try {
    const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    const appointments = await Appointment.find({ agentId: dbUser._id })
      .sort({ scheduledAt: 1 })
      .populate("leadId", "name email phone")
      .populate("listingId", "title address")
      .lean();

    return res.json({ appointments });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/appointments
router.post("/", async (req, res) => {
  try {
    const parsed = createAppointmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    const appointment = await Appointment.create({
      ...parsed.data,
      agentId: dbUser._id,
      scheduledAt: new Date(parsed.data.scheduledAt),
    });

    await triggerN8nWebhook("appointment-set", {
      appointmentId: appointment._id,
      agentId: dbUser._id,
      scheduledAt: appointment.scheduledAt,
    });

    return res.status(201).json({ appointment });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/appointments/:id
router.patch("/:id", async (req, res) => {
  try {
    const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    const appointment = await Appointment.findOneAndUpdate(
      { _id: req.params.id, agentId: dbUser._id },
      req.body,
      { new: true }
    );
    if (!appointment) return res.status(404).json({ error: "Appointment not found" });
    return res.json({ appointment });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/appointments/:id
router.delete("/:id", async (req, res) => {
  try {
    const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    await Appointment.findOneAndDelete({ _id: req.params.id, agentId: dbUser._id });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
