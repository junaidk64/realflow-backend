import { Request, Response, NextFunction } from 'express';
import { Lead } from '../models/Lead';
import { EmailLog } from '../models/EmailLog';
import mongoose from 'mongoose';
import logger from '../utils/logger';

export const getLeads = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const {
      page = '1',
      limit = '20',
      status,
      search,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, parseInt(limit, 10));
    const skip = (pageNum - 1) * limitNum;

    const filter: Record<string, unknown> = { userId };
    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) (filter.createdAt as Record<string, Date>).$gte = new Date(startDate);
      if (endDate) (filter.createdAt as Record<string, Date>).$lte = new Date(endDate);
    }
    if (search) {
      filter.$or = [
        { customerName: { $regex: search, $options: 'i' } },
        { customerEmail: { $regex: search, $options: 'i' } },
        { customerPhone: { $regex: search, $options: 'i' } },
        { fromAddress: { $regex: search, $options: 'i' } },
        { toAddress: { $regex: search, $options: 'i' } },
      ];
    }

    const sortDirection = sortOrder === 'asc' ? 1 : -1;

    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .sort({ [sortBy]: sortDirection })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Lead.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        leads,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
          hasNext: pageNum < Math.ceil(total / limitNum),
          hasPrev: pageNum > 1,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getLead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ success: false, message: 'Invalid lead ID' });
      return;
    }

    const lead = await Lead.findOne({ _id: id, userId: req.user!.userId });
    if (!lead) {
      res.status(404).json({ success: false, message: 'Lead not found' });
      return;
    }

    const emails = await EmailLog.find({ leadId: id }).sort({ createdAt: -1 }).limit(20);

    res.json({ success: true, data: { lead, emails } });
  } catch (error) {
    next(error);
  }
};

export const updateLead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, customerName, customerEmail, customerPhone, movingDate, fromAddress, toAddress, services, notes } = req.body;

    const updateData: Record<string, unknown> = {};
    if (status) updateData.status = status;
    if (customerName !== undefined) updateData.customerName = customerName;
    if (customerEmail !== undefined) updateData.customerEmail = customerEmail;
    if (customerPhone !== undefined) updateData.customerPhone = customerPhone;
    if (movingDate !== undefined) updateData.movingDate = movingDate;
    if (fromAddress !== undefined) updateData.fromAddress = fromAddress;
    if (toAddress !== undefined) updateData.toAddress = toAddress;
    if (services !== undefined) updateData.services = services;
    if (notes !== undefined) updateData.notes = notes;

    const lead = await Lead.findOneAndUpdate(
      { _id: id, userId: req.user!.userId },
      updateData,
      { new: true }
    );

    if (!lead) {
      res.status(404).json({ success: false, message: 'Lead not found' });
      return;
    }

    res.json({ success: true, data: { lead } });
  } catch (error) {
    next(error);
  }
};

export const deleteLead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const lead = await Lead.findOneAndDelete({ _id: id, userId: req.user!.userId });
    if (!lead) {
      res.status(404).json({ success: false, message: 'Lead not found' });
      return;
    }
    res.json({ success: true, message: 'Lead deleted' });
  } catch (error) {
    next(error);
  }
};

export const getLeadStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);

    const [
      total, todayCount, weekCount, monthCount,
      statusCounts, autoReplySent, n8nTriggered,
      dailyLeads
    ] = await Promise.all([
      Lead.countDocuments({ userId }),
      Lead.countDocuments({ userId, createdAt: { $gte: startOfDay } }),
      Lead.countDocuments({ userId, createdAt: { $gte: startOfWeek } }),
      Lead.countDocuments({ userId, createdAt: { $gte: startOfMonth } }),
      Lead.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Lead.countDocuments({ userId, autoReplySent: true }),
      Lead.countDocuments({ userId, n8nTriggered: true }),
      Lead.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId),
            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const statusMap = statusCounts.reduce((acc: Record<string, number>, s) => {
      acc[s._id] = s.count;
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        total, todayCount, weekCount, monthCount,
        statusBreakdown: statusMap,
        autoReplySent, n8nTriggered,
        dailyLeads,
        conversionRate: total > 0 ? Math.round(((statusMap.won || 0) / total) * 100) : 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const exportLeads = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { status, startDate, endDate } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = { userId };
    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) (filter.createdAt as Record<string, Date>).$gte = new Date(startDate);
      if (endDate) (filter.createdAt as Record<string, Date>).$lte = new Date(endDate);
    }

    const leads = await Lead.find(filter).sort({ createdAt: -1 }).lean();

    const csvRows = [
      'Name,Email,Phone,Moving Date,From,To,Services,Status,Auto Reply,Created',
      ...leads.map(l => [
        `"${l.customerName || ''}"`,
        `"${l.customerEmail || ''}"`,
        `"${l.customerPhone || ''}"`,
        `"${l.movingDate || ''}"`,
        `"${l.fromAddress || ''}"`,
        `"${l.toAddress || ''}"`,
        `"${(l.services || []).join('; ')}"`,
        l.status,
        l.autoReplySent ? 'Yes' : 'No',
        new Date(l.createdAt).toISOString(),
      ].join(',')),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${Date.now()}.csv"`);
    res.send(csvRows.join('\n'));
  } catch (error) {
    next(error);
  }
};

export const createLeadFromN8n = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      userId,
      source,
      rawEmailId,
      rawEmailSubject,
      rawEmailFrom,
      customerName,
      customerEmail,
      customerPhone,
      fromAddress,
      toAddress,
      movingDate,
      services,
      notes,
      confidence,
      status,
    } = req.body

    if (!userId) {
      res.status(400).json({ success: false, message: 'userId is required' })
      return
    }

    // n8n sends services as a JSON string
    let parsedServices: string[] = []
    if (typeof services === 'string') {
      try { parsedServices = JSON.parse(services) } catch { parsedServices = [] }
    } else if (Array.isArray(services)) {
      parsedServices = services
    }

    const lead = await Lead.create({
      userId,
      source: source || 'email',
      rawEmailId: rawEmailId || '',
      rawEmailSubject: rawEmailSubject || '',
      rawEmailFrom: rawEmailFrom || '',
      customerName: customerName || 'Unknown',
      customerEmail: customerEmail || '',
      customerPhone: customerPhone || '',
      fromAddress: fromAddress || '',
      toAddress: toAddress || '',
      movingDate: movingDate || '',
      services: parsedServices,
      notes: notes || '',
      confidence: confidence ?? 0,
      status: status || 'new',
    })

    logger.info(`Lead created by n8n: ${lead._id}`)
    res.status(201).json({ success: true, data: { lead } })
  } catch (error) {
    next(error)
  }
}

export default { getLeads, getLead, updateLead, deleteLead, getLeadStats, exportLeads, createLeadFromN8n };
