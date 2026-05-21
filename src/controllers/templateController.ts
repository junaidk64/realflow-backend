import { NextFunction, Request, Response } from 'express'
import mongoose from 'mongoose'
import { Template } from '../models/Template'

export const getTemplates = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const organizationId = req.user!.organizationId
		const {
			status,
			businessType,
			page = '1',
			limit = '20',
			includeSystem = 'true',
		} = req.query as Record<string, string>

		const pageNum = Math.max(1, parseInt(page, 10))
		const limitNum = Math.min(100, parseInt(limit, 10))
		const skip = (pageNum - 1) * limitNum

		// Build filter conditions for user's own templates and optionally system templates
		const filterConditions: Record<string, unknown>[] = [
			{ organizationId, isSystemTemplate: false },
		]

		// Add system templates if requested
		if (includeSystem === 'true') {
			filterConditions.push({ isSystemTemplate: true, status: 'approved' })
		}

		const filter: Record<string, unknown> = { $or: filterConditions }

		// Apply status filter to user's own templates (system templates are already filtered for 'approved')
		if (status) {
			// For $or query: add status to first condition (user templates) only
			;(filter.$or as Record<string, unknown>[])[0].status = status
		}

		// Apply businessType filter to both conditions
		if (businessType) {
			;(filter.$or as Record<string, unknown>[]).forEach((condition) => {
				condition.businessType = businessType
			})
		}

		const [templates, total] = await Promise.all([
			Template.find(filter)
				.sort({ updatedAt: -1 })
				.skip(skip)
				.limit(limitNum)
				.lean(),
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

export const getTemplate = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { id } = req.params
		if (!mongoose.isValidObjectId(id)) {
			res.status(400).json({ success: false, message: 'Invalid template ID' })
			return
		}

		const template = await Template.findOne({ _id: id })
		if (!template) {
			res.status(404).json({ success: false, message: 'Template not found' })
			return
		}

		res.json({ success: true, data: { template } })
	} catch (error) {
		next(error)
	}
}

export const createTemplate = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { name, description, htmlContent, businessType, tags } = req.body

		const template = await Template.create({
			userId: req.user!.userId,
			organizationId: req.user!.organizationId,
			name,
			description,
			htmlContent,
			businessType,
			tags: tags || [],
			status: 'approved',
		})

		res.status(201).json({ success: true, data: { template } })
	} catch (error) {
		next(error)
	}
}

export const updateTemplate = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { id } = req.params
		if (!mongoose.isValidObjectId(id)) {
			res.status(400).json({ success: false, message: 'Invalid template ID' })
			return
		}

		const template = await Template.findOne({ _id: id })
		if (!template) {
			res.status(404).json({ success: false, message: 'Template not found' })
			return
		}

		// If it's a system template, create a user copy instead of editing
		if (template.isSystemTemplate) {
			const userTemplate = await Template.create({
				userId: req.user!.userId,
				organizationId: req.user!.organizationId,
				name: req.body.name ?? template.name,
				description: req.body.description ?? template.description,
				htmlContent: req.body.htmlContent ?? template.htmlContent,
				businessType: req.body.businessType ?? template.businessType,
				tags: req.body.tags ?? template.tags,
				status: 'approved',
				isSystemTemplate: false,
				systemTemplateId: template._id,
			})

			res.json({ success: true, data: { template: userTemplate } })
			return
		}

		// Verify ownership of non-system template
		if (template.organizationId?.toString() !== req.user!.organizationId) {
			res.status(403).json({ success: false, message: 'Unauthorized' })
			return
		}

		if (req.body.name !== undefined) template.name = req.body.name
		if (req.body.description !== undefined)
			template.description = req.body.description
		if (req.body.htmlContent !== undefined)
			template.htmlContent = req.body.htmlContent
		if (req.body.businessType !== undefined)
			template.businessType = req.body.businessType
		if (req.body.tags !== undefined) template.tags = req.body.tags

		if (template.status === 'rejected') {
			template.status = 'approved'
			template.rejectionReason = null
		}

		await template.save()
		res.json({ success: true, data: { template } })
	} catch (error) {
		next(error)
	}
}

export const deleteTemplate = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { id } = req.params
		if (!mongoose.isValidObjectId(id)) {
			res.status(400).json({ success: false, message: 'Invalid template ID' })
			return
		}

		const template = await Template.findOneAndDelete({
			_id: id,
			organizationId: req.user!.organizationId,
		})
		if (!template) {
			res.status(404).json({ success: false, message: 'Template not found' })
			return
		}

		res.json({ success: true, message: 'Template deleted successfully' })
	} catch (error) {
		next(error)
	}
}

export const getSystemTemplates = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const {
			businessType,
			page = '1',
			limit = '20',
		} = req.query as Record<string, string>

		const pageNum = Math.max(1, parseInt(page, 10))
		const limitNum = Math.min(100, parseInt(limit, 10))
		const skip = (pageNum - 1) * limitNum

		const filter: Record<string, unknown> = {
			isSystemTemplate: true,
			status: 'approved',
		}
		if (businessType) filter.businessType = businessType

		const [templates, total] = await Promise.all([
			Template.find(filter)
				.select('-htmlContent')
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limitNum)
				.lean(),
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

export const publishTemplate = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { id } = req.params
		if (!mongoose.isValidObjectId(id)) {
			res.status(400).json({ success: false, message: 'Invalid template ID' })
			return
		}

		const template = await Template.findOne({
			_id: id,
			organizationId: req.user!.organizationId,
		})
		if (!template) {
			res.status(404).json({ success: false, message: 'Template not found' })
			return
		}

		if (!['draft', 'rejected'].includes(template.status)) {
			res.status(400).json({
				success: false,
				message: 'Only draft or rejected templates can be submitted for review',
			})
			return
		}
		template.status = 'approved'
		template.rejectionReason = null
		await template.save()

		res.json({
			success: true,
			message: 'Template submitted for review',
			data: { template },
		})
	} catch (error) {
		next(error)
	}
}

export const getPublicTemplates = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const {
			businessType,
			page = '1',
			limit = '20',
		} = req.query as Record<string, string>

		const pageNum = Math.max(1, parseInt(page, 10))
		const limitNum = Math.min(100, parseInt(limit, 10))
		const skip = (pageNum - 1) * limitNum

		const filter: Record<string, unknown> = { status: 'approved' }
		if (businessType) filter.businessType = businessType

		const [templates, total] = await Promise.all([
			Template.find(filter)
				.select('-htmlContent')
				.sort({ publishedAt: -1 })
				.skip(skip)
				.limit(limitNum)
				.lean(),
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

export const renderTemplate = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { id } = req.params
		if (!mongoose.isValidObjectId(id)) {
			res.status(400).json({ success: false, message: 'Invalid template ID' })
			return
		}

		const template = await Template.findOne({ _id: id, status: 'approved' })
		if (!template) {
			res
				.status(404)
				.json({ success: false, message: 'Template not found or not approved' })
			return
		}

		const variables: Record<string, string> = req.body.variables ?? {}
		const html = template.htmlContent.replace(/\{\{(\w+)\}\}/g, (_, key) =>
			String(variables[key] ?? ''),
		)

		res.json({ success: true, data: { html } })
	} catch (error) {
		next(error)
	}
}

export default {
	getTemplates,
	getTemplate,
	createTemplate,
	updateTemplate,
	deleteTemplate,
	getSystemTemplates,
	publishTemplate,
	getPublicTemplates,
	renderTemplate,
}
