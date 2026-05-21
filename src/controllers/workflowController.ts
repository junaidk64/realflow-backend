import { NextFunction, Request, Response } from 'express'
import {
	BACKEND_MANAGED_TYPES,
	SINGLETON_TYPES,
	WORKFLOW_CATALOGUE,
	getCatalogueItem,
} from '../config/workflowCatalogue'
import { Workflow } from '../models/Workflow'
import {
	activateWorkflow,
	createWorkflow as createN8nWorkflow,
	deactivateWorkflow,
	deleteWorkflow as deleteN8nWorkflow,
	getDefaultWorkflowTemplates,
	getWorkflowExecutions as getN8nWorkflowExecutions,
} from '../services/n8nService'
import logger from '../utils/logger'

// ─── Catalogue ────────────────────────────────────────────────────────────────

/**
 * GET /api/workflows/catalogue
 * Returns all available workflow types merged with the org's installed records.
 */
export const getCatalogue = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const orgId = req.user!.organizationId

		const installed = await Workflow.find({ organizationId: orgId }).lean()
		const installedByType = new Map(installed.map((w) => [w.type as string, w]))

		const items = WORKFLOW_CATALOGUE.map((def) => {
			const workflow = installedByType.get(def.type) ?? null
			return {
				...def,
				installed: workflow !== null,
				workflow,
			}
		})

		res.json({ success: true, data: { catalogue: items } })
	} catch (error) {
		next(error)
	}
}

// ─── Install ──────────────────────────────────────────────────────────────────

/**
 * POST /api/workflows/install/:type
 * Installs a backend-managed workflow for the org. Singleton types (all backend-
 * managed ones) can only be installed once per org. Created inactive by default
 * so the user must explicitly enable.
 */
export const installWorkflow = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { type } = req.params
		const orgId = req.user!.organizationId
		const userId = req.user!.userId

		const def = getCatalogueItem(type)
		if (!def) {
			res
				.status(400)
				.json({ success: false, message: `Unknown workflow type: ${type}` })
			return
		}

		// Singleton check — backend-managed types may only be installed once per org
		if (SINGLETON_TYPES.has(type)) {
			const existing = await Workflow.findOne({ organizationId: orgId, type })
			if (existing) {
				res.status(409).json({
					success: false,
					message: `${def.name} is already installed for this organisation.`,
					data: { workflow: existing },
				})
				return
			}
		}

		const workflow = await Workflow.create({
			userId,
			organizationId: orgId,
			name: def.name,
			description: def.description,
			type,
			needsEmailTemplate: def.needsEmailTemplate,
			isActive: false,
			webhookUrl: '',
			config: def.defaultConfig,
			n8nWorkflowId: '',
		})

		res.status(201).json({ success: true, data: { workflow } })
	} catch (error) {
		next(error)
	}
}

// ─── List installed workflows ─────────────────────────────────────────────────

export const getWorkflows = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const workflows = await Workflow.find({
			organizationId: req.user!.organizationId,
		}).sort({
			createdAt: -1,
		})
		res.json({ success: true, data: { workflows } })
	} catch (error) {
		next(error)
	}
}

// ─── Create custom (n8n / webhook) workflow ───────────────────────────────────

/**
 * POST /api/workflows
 * Only for custom/n8n workflows. Backend-managed types must use POST /install/:type.
 */
export const createWorkflow = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const {
			name,
			description,
			webhookUrl,
			config: wfConfig,
			n8nWorkflowJson,
		} = req.body

		// Prevent creating backend-managed types via the general endpoint
		const requestedType = req.body.type || 'custom'
		if (BACKEND_MANAGED_TYPES.has(requestedType)) {
			res.status(400).json({
				success: false,
				message: `Use POST /api/workflows/install/${requestedType} to install this workflow.`,
			})
			return
		}

		let n8nWorkflowId = ''
		if (n8nWorkflowJson) {
			try {
				const n8nWf = await createN8nWorkflow(n8nWorkflowJson)
				n8nWorkflowId = n8nWf.id
			} catch (n8nError) {
				logger.warn('Failed to create n8n workflow:', n8nError)
			}
		}

		const workflow = await Workflow.create({
			userId: req.user!.userId,
			organizationId: req.user!.organizationId,
			name,
			description: description || '',
			n8nWorkflowId,
			type: 'custom',
			needsEmailTemplate: false,
			isActive: false,
			webhookUrl: webhookUrl || '',
			config: wfConfig || {},
		})

		res.status(201).json({ success: true, data: { workflow } })
	} catch (error) {
		next(error)
	}
}

// ─── Update ───────────────────────────────────────────────────────────────────

export const updateWorkflow = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { id } = req.params
		const {
			name,
			description,
			webhookUrl,
			isActive,
			config: wfConfig,
		} = req.body

		const workflow = await Workflow.findOne({
			_id: id,
			organizationId: req.user!.organizationId,
		})

		if (!workflow) {
			res.status(404).json({ success: false, message: 'Workflow not found' })
			return
		}

		// Validate template is selected before allowing auto_reply activation
		if (
			isActive === true &&
			workflow.needsEmailTemplate &&
			!wfConfig?.templateId &&
			!workflow.config?.templateId
		) {
			res.status(400).json({
				success: false,
				message:
					'Please select an email template before enabling this workflow.',
			})
			return
		}

		if (name !== undefined) workflow.name = name
		if (description !== undefined) workflow.description = description
		if (webhookUrl !== undefined) workflow.webhookUrl = webhookUrl
		if (isActive !== undefined) workflow.isActive = Boolean(isActive)
		if (wfConfig !== undefined) {
			const current = workflow.toObject().config ?? {}
			workflow.set('config', { ...current, ...wfConfig })
		}

		await workflow.save()
		res.json({ success: true, data: { workflow } })
	} catch (error) {
		next(error)
	}
}

// ─── Delete / Uninstall ───────────────────────────────────────────────────────

export const deleteWorkflow = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { id } = req.params
		const workflow = await Workflow.findOne({
			_id: id,
			organizationId: req.user!.organizationId,
		})

		if (!workflow) {
			res.status(404).json({ success: false, message: 'Workflow not found' })
			return
		}

		if (workflow.n8nWorkflowId) {
			try {
				await deleteN8nWorkflow(workflow.n8nWorkflowId)
			} catch (n8nError) {
				logger.warn(
					`Failed to delete n8n workflow ${workflow.n8nWorkflowId}:`,
					n8nError,
				)
			}
		}

		await Workflow.findByIdAndDelete(id)
		res.json({ success: true, message: 'Workflow uninstalled' })
	} catch (error) {
		next(error)
	}
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

export const toggleWorkflow = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { id } = req.params
		const workflow = await Workflow.findOne({
			_id: id,
			organizationId: req.user!.organizationId,
		})

		if (!workflow) {
			res.status(404).json({ success: false, message: 'Workflow not found' })
			return
		}

		const newState = !workflow.isActive

		// Block enabling auto_reply without a template
		if (
			newState &&
			workflow.needsEmailTemplate &&
			!workflow.config?.templateId
		) {
			res.status(400).json({
				success: false,
				message:
					'Please select an email template before enabling this workflow.',
			})
			return
		}

		// Only call n8n for custom workflows
		if (workflow.n8nWorkflowId && !BACKEND_MANAGED_TYPES.has(workflow.type)) {
			try {
				if (newState) {
					await activateWorkflow(workflow.n8nWorkflowId)
				} else {
					await deactivateWorkflow(workflow.n8nWorkflowId)
				}
			} catch (n8nError) {
				logger.warn(`Failed to toggle n8n workflow:`, n8nError)
			}
		}

		workflow.isActive = newState
		await workflow.save()

		res.json({ success: true, data: { workflow, isActive: newState } })
	} catch (error) {
		next(error)
	}
}
export const getWorkflowTemplates = async (
	_req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const templates = getDefaultWorkflowTemplates()
		res.json({ success: true, data: { templates } })
	} catch (error) {
		next(error)
	}
}

// ─── Assign template to auto_reply workflow ───────────────────────────────────

/**
 * PATCH /api/workflows/:id/template
 * Convenience endpoint to assign a template to an auto_reply workflow.
 * Also enables the workflow if a template wasn't previously set.
 */
export const assignTemplate = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { id } = req.params
		const { templateId, subject } = req.body

		if (!templateId) {
			res
				.status(400)
				.json({ success: false, message: 'templateId is required' })
			return
		}

		const workflow = await Workflow.findOne({
			_id: id,
			organizationId: req.user!.organizationId,
			// type: 'auto_reply',
		})

		if (!workflow) {
			res
				.status(404)
				.json({ success: false, message: 'Auto reply workflow not found' })
			return
		}

		const current = workflow.toObject().config ?? {}
		workflow.set('config', {
			...current,
			templateId,
			subject: subject ?? current.subject ?? null,
		})

		await workflow.save()
		res.json({ success: true, data: { workflow } })
	} catch (error) {
		next(error)
	}
}

// ─── Executions (n8n only) ────────────────────────────────────────────────────

export const getWorkflowExecutions = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { id } = req.params
		const workflow = await Workflow.findOne({
			_id: id,
			organizationId: req.user!.organizationId,
		})

		if (!workflow) {
			res.status(404).json({ success: false, message: 'Workflow not found' })
			return
		}

		if (!workflow.n8nWorkflowId) {
			res.json({ success: true, data: { executions: [] } })
			return
		}

		const executions = await getN8nWorkflowExecutions(workflow.n8nWorkflowId)
		res.json({ success: true, data: { executions } })
	} catch (error) {
		next(error)
	}
}

export default {
	getCatalogue,
	installWorkflow,
	getWorkflows,
	createWorkflow,
	updateWorkflow,
	deleteWorkflow,
	toggleWorkflow,
	assignTemplate,
	getWorkflowExecutions,
}
