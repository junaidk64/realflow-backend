import { Router, Request, Response, NextFunction } from 'express'
import { verifyToken, requireRole } from '../middlewares/auth'
import { User } from '../models/User'
import { Lead } from '../models/Lead'
import { UsageLog } from '../models/UsageLog'
import { Template } from '../models/Template'

const router = Router()

router.use(verifyToken)
router.use(requireRole(['admin']))

// GET /api/admin/users — list all users with plan info
router.get('/users', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page = '1', limit = '20' } = req.query as Record<string, string>
    const pageNum = Math.max(1, parseInt(page, 10))
    const limitNum = Math.min(100, parseInt(limit, 10))
    const skip = (pageNum - 1) * limitNum

    const [users, total] = await Promise.all([
      User.find().select('-__v').sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      User.countDocuments(),
    ])

    res.json({
      success: true,
      data: { users, total, pagination: { page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } },
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/stats — system-wide metrics
router.get('/stats', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    const [
      totalUsers,
      activeUsers,
      totalLeads,
      leadsThisMonth,
      leadsToday,
      pendingTemplates,
      usageCost,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      Lead.countDocuments(),
      Lead.countDocuments({ createdAt: { $gte: monthStart } }),
      Lead.countDocuments({ createdAt: { $gte: dayStart } }),
      Template.countDocuments({ status: 'pending' }),
      UsageLog.aggregate([
        { $match: { createdAt: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$costUsd' }, calls: { $sum: 1 } } },
      ]),
    ])

    const planBreakdown = await User.aggregate([
      { $group: { _id: '$plan', count: { $sum: 1 } } },
    ])

    res.json({
      success: true,
      data: {
        users: { total: totalUsers, active: activeUsers, byPlan: planBreakdown },
        leads: { total: totalLeads, thisMonth: leadsThisMonth, today: leadsToday },
        templates: { pendingReview: pendingTemplates },
        ai: {
          callsThisMonth: usageCost[0]?.calls ?? 0,
          costThisMonthUsd: Number((usageCost[0]?.total ?? 0).toFixed(4)),
        },
      },
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/usage — per-user AI cost breakdown
router.get('/usage', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const usage = await UsageLog.aggregate([
      { $match: { createdAt: { $gte: monthStart } } },
      { $group: { _id: '$userId', totalCost: { $sum: '$costUsd' }, calls: { $sum: 1 } } },
      { $sort: { totalCost: -1 } },
      { $limit: 50 },
    ])

    res.json({ success: true, data: { usage } })
  } catch (err) {
    next(err)
  }
})

export default router
