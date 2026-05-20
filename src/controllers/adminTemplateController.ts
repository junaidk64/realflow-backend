import { Request, Response, NextFunction } from 'express'
import mongoose from 'mongoose'
import { Template } from '../models/Template'

// ─── System template CRUD (admin only) ───────────────────────────────────────

export const listSystemTemplates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { businessType } = req.query as Record<string, string>
    const filter: Record<string, unknown> = { isSystemTemplate: true }
    if (businessType) filter.businessType = businessType

    const templates = await Template.find(filter).sort({ businessType: 1, name: 1 }).lean()
    res.json({ success: true, data: { templates } })
  } catch (error) {
    next(error)
  }
}

export const createSystemTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, description, htmlContent, businessType, tags } = req.body
    if (!name || !htmlContent || !businessType) {
      res.status(400).json({ success: false, message: 'name, htmlContent, and businessType are required' })
      return
    }

    const template = await Template.create({
      userId: null,
      organizationId: null,
      name,
      description: description || '',
      htmlContent,
      businessType,
      tags: tags || [],
      status: 'approved',
      publishedAt: new Date(),
      isSystemTemplate: true,
      systemTemplateId: null,
    })

    res.status(201).json({ success: true, data: { template } })
  } catch (error) {
    next(error)
  }
}

export const updateSystemTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ success: false, message: 'Invalid template ID' })
      return
    }

    const template = await Template.findOne({ _id: id, isSystemTemplate: true })
    if (!template) {
      res.status(404).json({ success: false, message: 'System template not found' })
      return
    }

    if (req.body.name !== undefined) template.name = req.body.name
    if (req.body.description !== undefined) template.description = req.body.description
    if (req.body.htmlContent !== undefined) template.htmlContent = req.body.htmlContent
    if (req.body.tags !== undefined) template.tags = req.body.tags

    await template.save()
    res.json({ success: true, data: { template } })
  } catch (error) {
    next(error)
  }
}

export const deleteSystemTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ success: false, message: 'Invalid template ID' })
      return
    }

    const template = await Template.findOneAndDelete({ _id: id, isSystemTemplate: true })
    if (!template) {
      res.status(404).json({ success: false, message: 'System template not found' })
      return
    }

    res.json({ success: true, message: 'System template deleted' })
  } catch (error) {
    next(error)
  }
}

// ─── User-submitted template moderation ──────────────────────────────────────

export const adminListTemplates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, businessType, page = '1', limit = '20' } = req.query as Record<string, string>

    const pageNum = Math.max(1, parseInt(page, 10))
    const limitNum = Math.min(100, parseInt(limit, 10))
    const skip = (pageNum - 1) * limitNum

    const filter: Record<string, unknown> = {}
    if (status) filter.status = status
    if (businessType) filter.businessType = businessType

    const [templates, total] = await Promise.all([
      Template.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limitNum).lean(),
      Template.countDocuments(filter),
    ])

    res.json({
      success: true,
      data: {
        templates,
        total,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
          hasNext: skip + templates.length < total,
          hasPrev: pageNum > 1,
        },
      },
    })
  } catch (error) {
    next(error)
  }
}

export const approveTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ success: false, message: 'Invalid template ID' })
      return
    }

    const template = await Template.findById(id)
    if (!template) {
      res.status(404).json({ success: false, message: 'Template not found' })
      return
    }

    if (template.status !== 'pending') {
      res.status(400).json({ success: false, message: 'Only pending templates can be approved' })
      return
    }

    template.status = 'approved'
    template.publishedAt = new Date()
    template.rejectionReason = null
    await template.save()

    res.json({ success: true, message: 'Template approved', data: { template } })
  } catch (error) {
    next(error)
  }
}

export const rejectTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ success: false, message: 'Invalid template ID' })
      return
    }

    const { reason } = req.body
    if (!reason) {
      res.status(400).json({ success: false, message: 'Rejection reason is required' })
      return
    }

    const template = await Template.findById(id)
    if (!template) {
      res.status(404).json({ success: false, message: 'Template not found' })
      return
    }

    if (template.status !== 'pending') {
      res.status(400).json({ success: false, message: 'Only pending templates can be rejected' })
      return
    }

    template.status = 'rejected'
    template.rejectionReason = reason
    await template.save()

    res.json({ success: true, message: 'Template rejected', data: { template } })
  } catch (error) {
    next(error)
  }
}

export default {
  listSystemTemplates,
  createSystemTemplate,
  updateSystemTemplate,
  deleteSystemTemplate,
  adminListTemplates,
  approveTemplate,
  rejectTemplate,
}
