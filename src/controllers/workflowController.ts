import { NextFunction, Request, Response } from 'express'
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

export const getWorkflows = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const workflows = await Workflow.find({ userId: req.user!.userId }).sort({
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
			config: wfConfig,
			n8nWorkflowJson,
		} = req.body

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
			name,
			description: description || '',
			n8nWorkflowId,
			type: type || 'custom',
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

		const workflow = await Workflow.findOne({ _id: id, userId: req.user!.userId })

		if (!workflow) {
			res.status(404).json({ success: false, message: 'Workflow not found' })
			return
		}

		if (name !== undefined) workflow.name = name
		if (description !== undefined) workflow.description = description
		if (webhookUrl !== undefined) workflow.webhookUrl = webhookUrl
		if (isActive !== undefined) workflow.isActive = Boolean(isActive)
		if (wfConfig !== undefined) {
			// Deep-merge so partial updates don't wipe other config keys
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
			userId: req.user!.userId,
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
			userId: req.user!.userId,
		})

		if (!workflow) {
			res.status(404).json({ success: false, message: 'Workflow not found' })
			return
		}

		const newState = !workflow.isActive

		if (workflow.n8nWorkflowId) {
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

export const getWorkflowExecutions = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const { id } = req.params
		const workflow = await Workflow.findOne({
			_id: id,
			userId: req.user!.userId,
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
