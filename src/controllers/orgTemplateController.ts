import { Request, Response, NextFunction } from 'express'
import mongoose from 'mongoose'
import { Template } from '../models/Template'

const ORG_TEMPLATE_LIMIT = 3

// GET /api/org-templates/system — browse all system templates (read-only, filtered by businessType)
export const getSystemTemplates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { businessType } = req.query as Record<string, string>
    const filter: Record<string, unknown> = { isSystemTemplate: true }
    if (businessType) filter.businessType = businessType

    const templates = await Template.find(filter)
      .select('-userId -organizationId -systemTemplateId')
      .sort({ businessType: 1, name: 1 })
      .lean()

    res.json({ success: true, data: { templates } })
  } catch (error) {
    next(error)
  }
}

// GET /api/org-templates — list this org's editable template copies
export const getOrgTemplates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const templates = await Template.find({
      organizationId: req.user!.organizationId,
      isSystemTemplate: false,
    })
      .populate('systemTemplateId', 'name businessType')
      .sort({ createdAt: 1 })
      .lean()

    res.json({
      success: true,
      data: {
        templates,
        remaining: Math.max(0, ORG_TEMPLATE_LIMIT - templates.length),
        limit: ORG_TEMPLATE_LIMIT,
      },
    })
  } catch (error) {
    next(error)
  }
}

// GET /api/org-templates/:id — get single org template
export const getOrgTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ success: false, message: 'Invalid template ID' })
      return
    }

    const template = await Template.findOne({
      _id: id,
      organizationId: req.user!.organizationId,
      isSystemTemplate: false,
    }).lean()

    if (!template) {
      res.status(404).json({ success: false, message: 'Template not found' })
      return
    }

    res.json({ success: true, data: { template } })
  } catch (error) {
    next(error)
  }
}

// POST /api/org-templates/clone/:systemTemplateId — clone a system template into org
export const cloneSystemTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { systemTemplateId } = req.params
    if (!mongoose.isValidObjectId(systemTemplateId)) {
      res.status(400).json({ success: false, message: 'Invalid system template ID' })
      return
    }

    const existing = await Template.countDocuments({
      organizationId: req.user!.organizationId,
      isSystemTemplate: false,
    })
    if (existing >= ORG_TEMPLATE_LIMIT) {
      res.status(400).json({
        success: false,
        message: `You can only have ${ORG_TEMPLATE_LIMIT} email templates. Delete one to add another.`,
      })
      return
    }

    const systemTemplate = await Template.findOne({ _id: systemTemplateId, isSystemTemplate: true })
    if (!systemTemplate) {
      res.status(404).json({ success: false, message: 'System template not found' })
      return
    }

    // Prevent cloning the same system template twice into the same org
    const alreadyCloned = await Template.findOne({
      organizationId: req.user!.organizationId,
      systemTemplateId,
    })
    if (alreadyCloned) {
      res.status(400).json({
        success: false,
        message: 'You already have a copy of this template. Edit the existing one instead.',
      })
      return
    }

    const clone = await Template.create({
      userId: req.user!.userId,
      organizationId: req.user!.organizationId,
      name: systemTemplate.name,
      description: systemTemplate.description,
      htmlContent: systemTemplate.htmlContent,
      businessType: systemTemplate.businessType,
      tags: [...systemTemplate.tags],
      status: 'approved',
      publishedAt: new Date(),
      isSystemTemplate: false,
      systemTemplateId: systemTemplate._id,
    })

    res.status(201).json({ success: true, data: { template: clone } })
  } catch (error) {
    next(error)
  }
}

// POST /api/org-templates — create a blank org template (not cloned from system)
export const createOrgTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const existing = await Template.countDocuments({
      organizationId: req.user!.organizationId,
      isSystemTemplate: false,
    })
    if (existing >= ORG_TEMPLATE_LIMIT) {
      res.status(400).json({
        success: false,
        message: `You can only have ${ORG_TEMPLATE_LIMIT} email templates. Delete one to add another.`,
      })
      return
    }

    const { name, description, htmlContent, businessType, tags } = req.body
    if (!name || !htmlContent || !businessType) {
      res.status(400).json({ success: false, message: 'name, htmlContent, and businessType are required' })
      return
    }

    const template = await Template.create({
      userId: req.user!.userId,
      organizationId: req.user!.organizationId,
      name,
      description: description || '',
      htmlContent,
      businessType,
      tags: tags || [],
      status: 'approved',
      publishedAt: new Date(),
      isSystemTemplate: false,
      systemTemplateId: null,
    })

    res.status(201).json({ success: true, data: { template } })
  } catch (error) {
    next(error)
  }
}

// PATCH /api/org-templates/:id — update org's own copy (html, name, description only)
export const updateOrgTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ success: false, message: 'Invalid template ID' })
      return
    }

    const template = await Template.findOne({
      _id: id,
      organizationId: req.user!.organizationId,
      isSystemTemplate: false,
    })

    if (!template) {
      res.status(404).json({ success: false, message: 'Template not found' })
      return
    }

    // Only allow editing content fields — businessType and isSystemTemplate are immutable
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

// DELETE /api/org-templates/:id — remove org's own copy
export const deleteOrgTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ success: false, message: 'Invalid template ID' })
      return
    }

    const template = await Template.findOneAndDelete({
      _id: id,
      organizationId: req.user!.organizationId,
      isSystemTemplate: false,
    })

    if (!template) {
      res.status(404).json({ success: false, message: 'Template not found' })
      return
    }

    res.json({ success: true, message: 'Template deleted' })
  } catch (error) {
    next(error)
  }
}

// POST /api/org-templates/:id/reset — reset org copy back to system template HTML
export const resetOrgTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ success: false, message: 'Invalid template ID' })
      return
    }

    const template = await Template.findOne({
      _id: id,
      organizationId: req.user!.organizationId,
      isSystemTemplate: false,
    })

    if (!template) {
      res.status(404).json({ success: false, message: 'Template not found' })
      return
    }

    if (!template.systemTemplateId) {
      res.status(400).json({ success: false, message: 'This template was not cloned from a system template and cannot be reset' })
      return
    }

    const systemTemplate = await Template.findOne({ _id: template.systemTemplateId, isSystemTemplate: true })
    if (!systemTemplate) {
      res.status(404).json({ success: false, message: 'Original system template no longer exists' })
      return
    }

    template.htmlContent = systemTemplate.htmlContent
    template.name = systemTemplate.name
    template.description = systemTemplate.description
    await template.save()

    res.json({ success: true, message: 'Template reset to system default', data: { template } })
  } catch (error) {
    next(error)
  }
}

export default {
  getSystemTemplates,
  getOrgTemplates,
  getOrgTemplate,
  cloneSystemTemplate,
  createOrgTemplate,
  updateOrgTemplate,
  deleteOrgTemplate,
  resetOrgTemplate,
}
