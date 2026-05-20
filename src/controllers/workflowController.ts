import { NextFunction, Request, Response } from 'express'
import { Workflow } from '../models/Workflow'
import {
	activateWorkflow,
	createWorkflow as createN8nWorkflow,
	deactivateWorkflow,
	deleteWorkflow as deleteN8nWorkflow,
	getWorkflowExecutions as getN8nWorkflowExecutions,
} from '../services/n8nService'
import logger from '../utils/logger'

// Workflows that are managed entirely by the backend (no n8n involved)
const BACKEND_MANAGED_TYPES = new Set([
	'lead_extraction',
	'auto_reply',
	'notification',
	'spam_filtering',
	'daily_digest',
])

// Workflows that require a template to be selected before enabling
const TEMPLATE_REQUIRED_TYPES = new Set(['auto_reply'])

export const getWorkflows = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const workflows = await Workflow.find({ organizationId: req.user!.organizationId }).sort({
			createdAt: -1,
		})
		res.json({ success: true, data: { workflows } })
	} catch (error) {
		next(error)
	}
}

export const createWorkflow = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const {
			name,
			description,
			type,
			webhookUrl,
			isActive,
			config: wfConfig,
			n8nWorkflowJson,
		} = req.body

		const resolvedType = type || 'custom'
		const needsEmailTemplate = TEMPLATE_REQUIRED_TYPES.has(resolvedType)

		let n8nWorkflowId = ''
		if (n8nWorkflowJson && !BACKEND_MANAGED_TYPES.has(resolvedType)) {
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
			type: resolvedType,
			needsEmailTemplate,
			isActive: typeof isActive === 'boolean' ? isActive : false,
			webhookUrl: webhookUrl || '',
			config: wfConfig || {},
		})

		res.status(201).json({ success: true, data: { workflow } })
	} catch (error) {
		next(error)
	}
}

export const updateWorkflow = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { id } = req.params
		const { name, description, webhookUrl, isActive, config: wfConfig } = req.body

		const workflow = await Workflow.findOne({ _id: id, organizationId: req.user!.organizationId })

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
				message: 'Please select an email template before enabling this workflow.',
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
		res.json({ success: true, message: 'Workflow deleted' })
	} catch (error) {
		next(error)
	}
}

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

		// Block enabling auto_reply without a template selected
		if (newState && workflow.needsEmailTemplate && !workflow.config?.templateId) {
			res.status(400).json({
				success: false,
				message: 'Please select an email template before enabling this workflow.',
			})
			return
		}

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
		// Return the canonical list of all supported workflow types so the frontend can
		// offer a "Add workflow" picker without hard-coding the list on the client.
		const templates = [
			{
				type: 'lead_extraction',
				name: 'Lead Extraction',
				description: 'Automatically extract leads from incoming emails using AI.',
				needsEmailTemplate: false,
				backendManaged: true,
			},
			{
				type: 'auto_reply',
				name: 'Auto Reply',
				description: 'Send an automatic reply email to every new lead using the selected template.',
				needsEmailTemplate: true,
				backendManaged: true,
			},
			{
				type: 'notification',
				name: 'Notifications',
				description: 'Push in-app notifications whenever a new lead is detected.',
				needsEmailTemplate: false,
				backendManaged: true,
			},
			{
				type: 'spam_filtering',
				name: 'Spam Filtering',
				description: 'Filter out spam and non-lead emails before processing.',
				needsEmailTemplate: false,
				backendManaged: true,
			},
			{
				type: 'daily_digest',
				name: 'Daily Digest',
				description: 'Receive a daily email summary of your leads every morning at 7 AM.',
				needsEmailTemplate: false,
				backendManaged: true,
			},
			{
				type: 'custom',
				name: 'Custom Webhook',
				description: 'Trigger a custom n8n workflow or external webhook when a lead is captured.',
				needsEmailTemplate: false,
				backendManaged: false,
			},
		]
		res.json({ success: true, data: { templates } })
	} catch (error) {
		next(error)
	}
}

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
	getWorkflows,
	createWorkflow,
	updateWorkflow,
	deleteWorkflow,
	toggleWorkflow,
	getWorkflowTemplates,
	getWorkflowExecutions,
}
