import { Router } from "express";
import { verifyFirebaseToken } from "../middleware/auth";
import { rateLimiter } from "../middleware/rateLimit";
import User from "../models/User";
import Lead from "../models/Lead";

const router = Router();
router.use(verifyFirebaseToken);
router.use(rateLimiter);

// GET /api/analytics/summary?days=30
router.get("/summary", async (req, res) => {
  try {
    const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    const days = parseInt(req.query.days as string) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [leadsByStage, leadsBySource, totalLeads, closedWon, recentLeads] = await Promise.all([
      Lead.aggregate([
        { $match: { agentId: dbUser._id } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Lead.aggregate([
        { $match: { agentId: dbUser._id } },
        { $group: { _id: "$source", count: { $sum: 1 } } },
      ]),
      Lead.countDocuments({ agentId: dbUser._id }),
      Lead.countDocuments({ agentId: dbUser._id, status: "closed-won" }),
      Lead.aggregate([
        { $match: { agentId: dbUser._id, createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const conversionRate = totalLeads > 0 ? ((closedWon / totalLeads) * 100).toFixed(1) : "0.0";

    return res.json({
      leadsByStage,
      leadsBySource,
      totalLeads,
      closedWon,
      conversionRate: `${conversionRate}%`,
      recentLeads,
      days,
    });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/analytics/agents — Brokerage plan only
router.get("/agents", async (req, res) => {
  try {
    const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    if (dbUser.plan !== "brokerage") {
      return res.status(403).json({ error: "Brokerage plan required.", upgrade: true });
    }

    const agentStats = await Lead.aggregate([
      {
        $group: {
          _id: "$agentId",
          totalLeads: { $sum: 1 },
          closedWon: { $sum: { $cond: [{ $eq: ["$status", "closed-won"] }, 1, 0] } },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "agent",
        },
      },
      { $unwind: "$agent" },
      {
        $project: {
          agentName: "$agent.name",
          agentEmail: "$agent.email",
          totalLeads: 1,
          closedWon: 1,
        },
      },
    ]);

    return res.json({ agents: agentStats });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
