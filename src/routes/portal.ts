import { Router } from "express";
import Lead from "../models/Lead";
import Appointment from "../models/Appointment";
import Document from "../models/Document";

const router = Router();

// GET /api/portal/:token — public, no auth required
router.get("/:token", async (req, res) => {
  try {
    const lead = await Lead.findOne({ portalToken: req.params.token })
      .populate("assignedListingId", "title address price images status")
      .lean();

    if (!lead) return res.status(404).json({ error: "Portal not found" });

    const [appointments, documents] = await Promise.all([
      Appointment.find({ leadId: lead._id })
        .select("title scheduledAt duration location status")
        .sort({ scheduledAt: 1 })
        .lean(),
      Document.find({ leadId: lead._id })
        .select("name fileUrl signingStatus createdAt")
        .lean(),
    ]);

    return res.json({
      lead: {
        name: lead.name,
        status: lead.status,
        propertyType: lead.propertyType,
        assignedListing: lead.assignedListingId,
      },
      appointments,
      documents,
    });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
